import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PacsRemapPage from "./pacs-remap-page";

const apiMock = vi.fn();
const previewMock = vi.fn();
const scanMock = vi.fn();
const buildPlanMock = vi.fn();
const buildSkipPreviewMock = vi.fn();

vi.mock("@/lib/api-client", () => {
  class ApiError extends Error {
    status: number;
    details?: unknown;
    constructor(message: string, status: number, details?: unknown) {
      super(message);
      this.status = status;
      this.details = details;
    }
  }
  return { api: (...args: unknown[]) => apiMock(...args), ApiError };
});

vi.mock("@/providers/language-provider", () => ({
  useLanguage: () => ({ language: "en" }),
}));

vi.mock("@/providers/auth-provider", () => ({
  useAuth: () => ({ user: { id: 1, role: "supervisor" } }),
}));

vi.mock("@/components/auth/supervisor-reauth-modal", () => ({
  SupervisorReAuthModal: () => null,
}));

vi.mock("@/lib/dicom-study-scan", () => ({
  previewDicomStudiesFromFiles: (...args: unknown[]) => previewMock(...args),
  scanDicomStudiesFromFiles: (...args: unknown[]) => scanMock(...args),
  buildDicomUploadSelectionPlan: (...args: unknown[]) => buildPlanMock(...args),
  buildSkipPreviewScanResult: (...args: unknown[]) => buildSkipPreviewMock(...args),
}));

class FakeXHR {
  static instances: FakeXHR[] = [];
  withCredentials = false;
  readyState = 0;
  status = 0;
  responseText = "";
  upload = {
    onprogress: null as ((event: ProgressEvent<EventTarget>) => void) | null,
    onload: null as (() => void) | null,
  };
  onreadystatechange: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  sentBody: FormData | null = null;
  method = "";
  url = "";
  constructor() {
    FakeXHR.instances.push(this);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  send(body?: Document | XMLHttpRequestBodyInit | null) {
    this.sentBody = body as FormData;
    this.upload.onload?.();
    this.status = 201;
    this.responseText = JSON.stringify({ job: { id: 88, status: "sent" }, skippedFilesCount: 0 });
    this.readyState = 4;
    this.onreadystatechange?.();
  }
  abort() {
    this.onabort?.();
  }
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PacsRemapPage />
    </QueryClientProvider>
  );
}

describe("PacsRemapPage wizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeXHR.instances.length = 0;
    previewMock.mockImplementation((...args: unknown[]) => scanMock(...args));
    buildSkipPreviewMock.mockImplementation((inputFiles: File[]) => ({
      studies: [],
      skippedSidecarCount: 0,
      unparsedCount: 0,
      totalFileCount: inputFiles.length,
      dicomLikeFileCount: inputFiles.length,
      parsedDicomFileCount: 0,
      fallbackUploadFiles: inputFiles,
      unparsedFiles: [],
    }));
    vi.stubGlobal("XMLHttpRequest", FakeXHR as unknown as typeof XMLHttpRequest);
    apiMock.mockImplementation((path: string) => {
      if (path === "/pacs/remap/destinations") return Promise.resolve({ destinations: [{ key: "1", name: "Main PACS", isDefault: true }] });
      if (String(path).startsWith("/v2/read/appointments?dateFrom=")) {
        return Promise.resolve({ appointments: [{ id: 201, patient_id: 10, accession_number: "ACC-1", appointment_date: "2026-01-01", modality_id: 3, modality_name_en: "CT", exam_name_en: "CT Brain", english_full_name: "John Doe", national_id: "N1", mrn: "MRN-1" }] });
      }
      if (String(path).startsWith("/v2/read/appointments?q=")) {
        return Promise.resolve({ appointments: [{ id: 301, patient_id: 10, accession_number: "ACC-2", appointment_date: "2026-01-02", modality_id: 3, modality_name_en: "CT", exam_name_en: "CT Brain", english_full_name: "John Doe", national_id: "N1", mrn: "MRN-1" }] });
      }
      if (String(path).startsWith("/patients?q=")) {
        return Promise.resolve({ patients: [{ id: 55, english_full_name: "Jane Roe", national_id: "N55", mrn: "MRN-55" }] });
      }
      if (path === "/pacs/remap/replacement-preview") {
        return Promise.resolve({ replacement: { patientId: "N1", patientName: "John^Doe", patientSex: "M", patientBirthDate: "19900101" } });
      }
      if (String(path).includes("/jobs/88")) return Promise.resolve({ job: { id: 88, status: "sent" }, comparison: null });
      if (String(path).includes("/pacs/remap/jobs")) return Promise.resolve({ jobs: [] });
      return Promise.resolve({});
    });
  });

  it("does not auto-upload after selecting files", async () => {
    scanMock.mockResolvedValue({ studies: [], skippedSidecarCount: 0, unparsedCount: 0, filesByStudyUid: new Map() });
    buildPlanMock.mockReturnValue({ files: [], usesFallback: false });
    renderPage();
    const fileInput = screen.getByLabelText("Select DICOM files") as HTMLInputElement;
    const file = new File(["x"], "a.dcm", { type: "application/dicom" });
    fireEvent.change(fileInput, { target: { files: [file] } });
    expect(scanMock).not.toHaveBeenCalled();
    expect(FakeXHR.instances.length).toBe(0);
  });

  it("clicking scan uses preview endpoint path before heavy process upload", async () => {
    previewMock.mockResolvedValue({
      studies: [
        { studyInstanceUid: "1.2.3", studyDescription: "Preview", studyDate: "20260101", modality: "CT", patientId: "P1", patientName: "Preview^Patient", seriesCount: 1, fileCount: 1, totalBytes: 10, files: [new File(["1"], "a1.dcm")] },
      ],
      skippedSidecarCount: 0,
      unparsedCount: 0,
      fallbackUploadFiles: [],
      unparsedFiles: [],
      previewOnly: true,
    });
    renderPage();
    fireEvent.change(screen.getByLabelText("Select DICOM files"), { target: { files: [new File(["x"], "a.dcm")] } });
    fireEvent.click(screen.getByRole("button", { name: "Scan selected folder/files" }));
    await screen.findByText(/Detected 1 studies/i);
    expect(previewMock).toHaveBeenCalledTimes(1);
    expect(scanMock).not.toHaveBeenCalled();
    expect(FakeXHR.instances.length).toBe(0);
  });

  it("renders study cards from preview response", async () => {
    previewMock.mockResolvedValue({
      studies: [
        { studyInstanceUid: "9.8.7", studyDescription: "Fast Preview Study", studyDate: "20260505", modality: "MR", patientId: "PX", patientName: "Fast^Patient", seriesCount: 1, fileCount: 1, totalBytes: 10, files: [new File(["1"], "p1.dcm")] },
      ],
      skippedSidecarCount: 0,
      unparsedCount: 0,
      fallbackUploadFiles: [],
      unparsedFiles: [],
      previewOnly: true,
    });
    renderPage();
    fireEvent.change(screen.getByLabelText("Select DICOM files"), { target: { files: [new File(["x"], "a.dcm")] } });
    fireEvent.click(screen.getByRole("button", { name: "Scan selected folder/files" }));
    expect((await screen.findAllByText(/Fast Preview Study/i)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/Fast\^Patient/i)).length).toBeGreaterThan(0);
  });

  it("requires explicit study selection when multiple studies detected", async () => {
    scanMock.mockResolvedValue({
      studies: [
        { studyInstanceUid: "1", studyDescription: "A", studyDate: "20260101", modality: "CT", patientId: "P1", patientName: "One", seriesCount: 1, fileCount: 1, totalBytes: 10, files: [new File(["1"], "a1.dcm")] },
        { studyInstanceUid: "2", studyDescription: "B", studyDate: "20260101", modality: "MR", patientId: "P2", patientName: "Two", seriesCount: 1, fileCount: 1, totalBytes: 10, files: [new File(["1"], "b1.dcm")] },
      ],
      skippedSidecarCount: 0,
      unparsedCount: 0,
      filesByStudyUid: new Map(),
    });
    renderPage();
    fireEvent.change(screen.getByLabelText("Select DICOM files"), { target: { files: [new File(["x"], "a.dcm")] } });
    fireEvent.click(screen.getByRole("button", { name: "Scan selected folder/files" }));
    await screen.findByText(/Multiple studies detected/i);
    expect((screen.getByRole("button", { name: "Upload selected study, remap, and send to PACS" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("preselects one detected study but waits for explicit upload", async () => {
    scanMock.mockResolvedValue({
      studies: [
        { studyInstanceUid: "1.2.3", studyDescription: "A", studyDate: "20260101", modality: "CT", patientId: "P1", patientName: "One", seriesCount: 1, fileCount: 2, totalBytes: 20, files: [new File(["1"], "a1.dcm"), new File(["2"], "a2.dcm")] },
      ],
      skippedSidecarCount: 0,
      unparsedCount: 0,
      filesByStudyUid: new Map(),
    });
    buildPlanMock.mockReturnValue({ files: [new File(["1"], "a1.dcm"), new File(["2"], "a2.dcm")], usesFallback: false });
    renderPage();
    fireEvent.change(screen.getByLabelText("Select DICOM files"), { target: { files: [new File(["x"], "a.dcm")] } });
    fireEvent.click(screen.getByRole("button", { name: "Scan selected folder/files" }));
    await screen.findByText(/Detected 1 studies/i);
    expect(FakeXHR.instances.length).toBe(0);
  });

  it("marks the active wizard card after scan", async () => {
    scanMock.mockResolvedValue({
      studies: [
        { studyInstanceUid: "1.2.3", studyDescription: "A", studyDate: "20260101", modality: "CT", patientId: "P1", patientName: "One", seriesCount: 1, fileCount: 1, totalBytes: 10, files: [new File(["1"], "a1.dcm")] },
      ],
      skippedSidecarCount: 0,
      unparsedCount: 0,
      filesByStudyUid: new Map(),
    });
    renderPage();
    fireEvent.change(screen.getByLabelText("Select DICOM files"), { target: { files: [new File(["1"], "a1.dcm")] } });
    fireEvent.click(screen.getByRole("button", { name: "Scan selected folder/files" }));
    await screen.findByText(/Detected 1 studies/i);
    const activeCards = document.querySelectorAll("[data-active-step='true']");
    expect(activeCards.length).toBe(1);
    expect(activeCards[0]?.textContent || "").toContain("Step 2: Choose study");
  });

  it("uploads only selected study files and includes selectedStudyInstanceUID", async () => {
    const selectedFiles = [new File(["1"], "a1.dcm"), new File(["2"], "a2.dcm")];
    scanMock.mockResolvedValue({
      studies: [
        { studyInstanceUid: "1.2.3", studyDescription: "A", studyDate: "20260101", modality: "CT", patientId: "P1", patientName: "One", seriesCount: 1, fileCount: 2, totalBytes: 20, files: selectedFiles },
      ],
      skippedSidecarCount: 0,
      unparsedCount: 0,
      filesByStudyUid: new Map(),
    });
    buildPlanMock.mockReturnValue({ files: selectedFiles, usesFallback: false });
    renderPage();
    fireEvent.change(screen.getByLabelText("Select DICOM files"), { target: { files: selectedFiles } });
    fireEvent.click(screen.getByRole("button", { name: "Scan selected folder/files" }));
    await screen.findByText(/Detected 1 studies/i);
    fireEvent.click(await screen.findByRole("button", { name: /John Doe/i }));
    const comboBoxes = screen.getAllByRole("combobox");
    fireEvent.change(comboBoxes[2] as HTMLSelectElement, { target: { value: "1" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "I confirm this is the correct study and correct RISPro patient." }));
    const uploadButton = await screen.findByRole("button", { name: "Upload selected study, remap, and send to PACS" });
    fireEvent.click(uploadButton);
    await waitFor(() => expect(FakeXHR.instances.length).toBe(1));
    const sent = FakeXHR.instances[0]?.sentBody;
    expect(sent).toBeInstanceOf(FormData);
    expect(FakeXHR.instances[0]?.url).toBe("/api/pacs/remap/jobs/process-multipart");
    const fileEntries = sent?.getAll("files") ?? [];
    expect(fileEntries).toHaveLength(2);
    expect((sent?.get("selectedStudyInstanceUID") as string) || "").toBe("1.2.3");
    expect((sent?.get("risproPatientId") as string) || "").toBe("10");
    expect((sent?.get("destinationPacsKey") as string) || "").toBe("1");
    expect((sent?.get("confirm") as string) || "").toBe("true");
  });

  it("final confirmed action still posts full files to process-multipart after fast preview", async () => {
    const fullFiles = [new File(["full-1"], "full1.dcm"), new File(["full-2"], "full2.dcm")];
    previewMock.mockResolvedValue({
      studies: [
        { studyInstanceUid: "1.2.3", studyDescription: "Preview", studyDate: "20260101", modality: "CT", patientId: "P1", patientName: "One", seriesCount: 1, fileCount: 1, totalBytes: 10, files: [fullFiles[0]] },
      ],
      skippedSidecarCount: 0,
      unparsedCount: 0,
      fallbackUploadFiles: [fullFiles[0]],
      unparsedFiles: [],
      previewOnly: true,
    });
    scanMock.mockResolvedValue({
      studies: [
        { studyInstanceUid: "1.2.3", studyDescription: "Preview", studyDate: "20260101", modality: "CT", patientId: "P1", patientName: "One", seriesCount: 1, fileCount: 2, totalBytes: 20, files: fullFiles },
      ],
      skippedSidecarCount: 0,
      unparsedCount: 0,
      fallbackUploadFiles: fullFiles,
      unparsedFiles: [],
    });
    buildPlanMock.mockReturnValue({ files: fullFiles, selectedStudyInstanceUid: "1.2.3", usesFallback: false });
    renderPage();
    fireEvent.change(screen.getByLabelText("Select DICOM files"), { target: { files: fullFiles } });
    fireEvent.click(screen.getByRole("button", { name: "Scan selected folder/files" }));
    await screen.findByText(/Detected 1 studies/i);
    fireEvent.click(await screen.findByRole("button", { name: /John Doe/i }));
    const comboBoxes = screen.getAllByRole("combobox");
    fireEvent.change(comboBoxes[2] as HTMLSelectElement, { target: { value: "1" } });
    expect(await screen.findByText(/CD study contents/i)).toBeTruthy();
    expect(await screen.findByText(/full1\.dcm/i)).toBeTruthy();
    expect(await screen.findByText(/full2\.dcm/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "I confirm this is the correct study and correct RISPro patient." }));
    const uploadButton = await screen.findByRole("button", { name: "Upload selected study, remap, and send to PACS" });
    fireEvent.click(uploadButton);

    await waitFor(() => expect(FakeXHR.instances.length).toBe(1));
    expect(scanMock).not.toHaveBeenCalled();
    expect(FakeXHR.instances[0]?.url).toBe("/api/pacs/remap/jobs/process-multipart");
    expect(FakeXHR.instances[0]?.sentBody?.getAll("files")).toHaveLength(2);
  });

  it("skip preview uploads all selected DICOM-like files without scan or selectedStudyInstanceUID", async () => {
    const selectedFiles = [new File(["1"], "a1.dcm"), new File(["2"], "a2.dcm")];
    buildPlanMock.mockReturnValue({ files: selectedFiles, selectedStudyInstanceUid: null, usesFallback: true });
    renderPage();
    fireEvent.change(screen.getByLabelText("Select DICOM files"), { target: { files: selectedFiles } });
    const skipButton = screen.getByRole("button", { name: "Skip preview" }) as HTMLButtonElement;
    await waitFor(() => expect(skipButton.disabled).toBe(false));
    fireEvent.click(skipButton);
    expect(previewMock).not.toHaveBeenCalled();
    expect(scanMock).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: /John Doe/i }));
    const comboBoxes = screen.getAllByRole("combobox");
    fireEvent.change(comboBoxes[2] as HTMLSelectElement, { target: { value: "1" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "I confirm this is the correct study and correct RISPro patient." }));
    fireEvent.click(await screen.findByRole("button", { name: "Upload selected study, remap, and send to PACS" }));

    await waitFor(() => expect(FakeXHR.instances.length).toBe(1));
    const sent = FakeXHR.instances[0]?.sentBody;
    expect(sent?.getAll("files")).toHaveLength(2);
    expect(sent?.get("selectedStudyInstanceUID")).toBeNull();
    expect(sent?.get("uploadMode")).toBe("fallback_all_candidates");
  });

  it("preselects the default PACS destination", async () => {
    scanMock.mockResolvedValue({
      studies: [
        { studyInstanceUid: "1.2.3", studyDescription: "A", studyDate: "20260101", modality: "CT", patientId: "P1", patientName: "One", seriesCount: 1, fileCount: 1, totalBytes: 10, files: [new File(["1"], "a1.dcm")] },
      ],
      skippedSidecarCount: 0,
      unparsedCount: 0,
      filesByStudyUid: new Map(),
    });
    renderPage();
    fireEvent.change(screen.getByLabelText("Select DICOM files"), { target: { files: [new File(["1"], "a1.dcm")] } });
    fireEvent.click(screen.getByRole("button", { name: "Scan selected folder/files" }));
    await screen.findByText(/Detected 1 studies/i);
    const comboBoxes = screen.getAllByRole("combobox");
    expect((comboBoxes.at(-1) as HTMLSelectElement).value).toBe("1");
  });

  it("does not use FileReader/readAsDataURL for upload path", async () => {
    const readAsDataURL = vi.fn();
    vi.stubGlobal("FileReader", class {
      readAsDataURL = readAsDataURL;
    });
    scanMock.mockResolvedValue({
      studies: [{ studyInstanceUid: "1.2.3", studyDescription: "A", studyDate: "", modality: "", patientId: "", patientName: "", seriesCount: 1, fileCount: 1, totalBytes: 10, files: [new File(["1"], "a1.dcm")] }],
      skippedSidecarCount: 0,
      unparsedCount: 0,
      filesByStudyUid: new Map(),
    });
    buildPlanMock.mockReturnValue({ files: [new File(["1"], "a1.dcm")], usesFallback: false });
    renderPage();
    fireEvent.change(screen.getByLabelText("Select DICOM files"), { target: { files: [new File(["1"], "a1.dcm")] } });
    fireEvent.click(screen.getByRole("button", { name: "Scan selected folder/files" }));
    await screen.findByText(/Detected 1 studies/i);
    expect(readAsDataURL).not.toHaveBeenCalled();
  });

  it("allows selecting a RISPro patient without an appointment", async () => {
    scanMock.mockResolvedValue({
      studies: [
        { studyInstanceUid: "1.2.3", studyDescription: "A", studyDate: "20260101", modality: "CT", patientId: "P1", patientName: "One", seriesCount: 1, fileCount: 1, totalBytes: 10, files: [new File(["1"], "a1.dcm")] },
      ],
      skippedSidecarCount: 0,
      unparsedCount: 0,
      filesByStudyUid: new Map(),
    });
    renderPage();
    fireEvent.change(screen.getByLabelText("Select DICOM files"), { target: { files: [new File(["1"], "a1.dcm")] } });
    fireEvent.click(screen.getByRole("button", { name: "Scan selected folder/files" }));
    await screen.findByText(/Detected 1 studies/i);
    fireEvent.change(screen.getByDisplayValue("Appointments for selected date"), { target: { value: "all_patients" } });
    fireEvent.change(screen.getByPlaceholderText("Search by patient name, national ID, or MRN"), { target: { value: "Jane" } });
    fireEvent.click(await screen.findByRole("button", { name: /Jane Roe/i }));
    expect(await screen.findByText(/Selected without appointment/i)).toBeTruthy();
  });
});
