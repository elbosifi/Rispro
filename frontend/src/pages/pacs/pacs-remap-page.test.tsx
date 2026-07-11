import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PacsRemapPage from "./pacs-remap-page";

const apiMock = vi.fn();
const previewMock = vi.fn();
const scanMock = vi.fn();
const buildPlanMock = vi.fn();

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

vi.mock("@/providers/language-provider", () => ({ useLanguage: () => ({ language: "en" }) }));
vi.mock("@/providers/auth-provider", () => ({ useAuth: () => ({ user: { id: 1, role: "supervisor" } }) }));
vi.mock("@/components/auth/supervisor-reauth-modal", () => ({ SupervisorReAuthModal: () => null }));
vi.mock("@/lib/dicom-study-scan", () => ({
  DicomStudyScanCancelledError: class DicomStudyScanCancelledError extends Error {},
  previewDicomStudiesFromFiles: (...args: unknown[]) => previewMock(...args),
  scanDicomStudiesFromFiles: (...args: unknown[]) => scanMock(...args),
  buildDicomUploadSelectionPlan: (...args: unknown[]) => buildPlanMock(...args),
  isLikelyDicomCandidate: () => true,
}));

class FakeXHR {
  static DONE = 4;
  static instances: FakeXHR[] = [];
  withCredentials = false;
  readyState = 0;
  status = 0;
  responseText = "";
  upload = {
    onprogress: null as ((event: ProgressEvent<EventTarget>) => void) | null,
    onload: null as (() => void) | null,
    onloadend: null as (() => void) | null,
  };
  onreadystatechange: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  sentBody: FormData | null = null;
  url = "";
  constructor() { FakeXHR.instances.push(this); }
  open(_method: string, url: string) { this.url = url; }
  send(body?: Document | XMLHttpRequestBodyInit | null) {
    this.sentBody = body as FormData;
    this.upload.onprogress?.({ loaded: 5, total: 10 } as ProgressEvent<EventTarget>);
    this.upload.onload?.();
    this.status = 202;
    this.responseText = JSON.stringify({ job: { id: 88, status: "sending" }, skippedFilesCount: 0 });
    this.readyState = FakeXHR.DONE;
    this.onreadystatechange?.();
  }
  abort() { this.onabort?.(); }
}

function study(uid = "1.2.3", description = "CT Chest") {
  const file = new File(["dicom"], `${description.replace(/\\s/g, "-")}.dcm`);
  return { studyInstanceUid: uid, studyDescription: description, studyDate: "20260101", modality: "CT", patientId: "P1", patientName: "One^Patient", seriesCount: 1, fileCount: 1, totalBytes: file.size, files: [file] };
}

function result(studies = [study()]) {
  return { studies, skippedSidecarCount: 0, unparsedCount: 0, totalFileCount: 1, dicomLikeFileCount: 1, parsedDicomFileCount: 1, fallbackUploadFiles: studies.flatMap((item) => item.files), unparsedFiles: [] };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><PacsRemapPage /></QueryClientProvider>);
}

async function scanOne() {
  const file = new File(["x"], "a.dcm", { type: "application/dicom" });
  fireEvent.change(screen.getByLabelText("Select DICOM files"), { target: { files: [file] } });
  await screen.findByText(/Complete folder scan complete/i);
  return file;
}

describe("PacsRemapPage five-step wizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeXHR.instances.length = 0;
    previewMock.mockResolvedValue(result());
    scanMock.mockResolvedValue(result());
    buildPlanMock.mockReturnValue({ files: [new File(["x"], "a.dcm")], selectedStudyInstanceUid: "1.2.3", usesFallback: false });
    apiMock.mockImplementation((path: string) => {
      if (path === "/pacs/remap/destinations") return Promise.resolve({ destinations: [{ key: "1", name: "Main PACS", isDefault: true }] });
      if (String(path).startsWith("/v2/read/appointments?dateFrom=")) return Promise.resolve({ appointments: [{ id: 201, patient_id: 10, accession_number: "ACC-1", appointment_date: "2026-01-01", modality_id: 3, modality_name_en: "CT", exam_name_en: "CT Brain", english_full_name: "John Doe", national_id: "N1" }] });
      if (path === "/pacs/remap/replacement-preview") return Promise.resolve({ replacement: { patientId: "N1", patientName: "John^Doe", patientSex: "M", patientBirthDate: "19900101" } });
      if (String(path).includes("/jobs/88")) return Promise.resolve({ job: { id: 88, status: "sending", destination_pacs_key: "1", processing_stage: "enqueueing_send" }, comparison: null });
      if (String(path).includes("/pacs/remap/jobs")) return Promise.resolve({ jobs: [] });
      return Promise.resolve({ items: [] });
    });
    vi.stubGlobal("XMLHttpRequest", FakeXHR as unknown as typeof XMLHttpRequest);
  });

  it("initially mounts only Source and exposes five non-clickable steps", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Source" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Patient" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Destination" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Review" })).toBeNull();
    expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
    expect(screen.getAllByText(/Source|Patient|Destination|Review|Processing/).length).toBeGreaterThanOrEqual(5);
  });

  it("keeps quick preview and complete scan inside Source and gates Continue", async () => {
    renderPage();
    const continueButton = screen.getByRole("button", { name: "Continue to Patient" }) as HTMLButtonElement;
    expect(continueButton.disabled).toBe(true);
    await scanOne();
    expect(screen.getByRole("heading", { name: "Source" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Continue to Patient" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("heading", { name: "Patient" })).toBeNull();
  });

  it("requires explicit study selection when multiple studies are detected", async () => {
    scanMock.mockResolvedValue(result([study("1", "A"), study("2", "B")]));
    renderPage();
    await scanOne();
    expect((screen.getByRole("button", { name: "Continue to Patient" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getAllByRole("radio")[1]!);
    expect((screen.getByRole("button", { name: "Continue to Patient" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("uses explicit navigation and preserves the source without rescanning", async () => {
    renderPage();
    await scanOne();
    fireEvent.click(screen.getByRole("button", { name: "Continue to Patient" }));
    expect(await screen.findByRole("heading", { name: "Patient" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Source" })).toBeTruthy();
    expect(scanMock).toHaveBeenCalledTimes(1);
  });

  it("does not auto-advance on patient selection and requires replacement preview", async () => {
    renderPage();
    await scanOne();
    fireEvent.click(screen.getByRole("button", { name: "Continue to Patient" }));
    const patientButton = await screen.findByRole("button", { name: /John Doe/ });
    fireEvent.click(patientButton);
    expect(screen.getByRole("heading", { name: "Patient" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Destination" })).toBeNull();
    await waitFor(() => expect((screen.getByRole("button", { name: "Continue to Destination" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("does not auto-advance on destination selection and preserves the patient on Back", async () => {
    renderPage();
    await scanOne();
    fireEvent.click(screen.getByRole("button", { name: "Continue to Patient" }));
    fireEvent.click(await screen.findByRole("button", { name: /John Doe/ }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Continue to Destination" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Continue to Destination" }));
    expect(screen.getByRole("heading", { name: "Destination" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Review" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("heading", { name: "Patient" })).toBeTruthy();
    expect(screen.getAllByText(/John Doe/).length).toBeGreaterThan(0);
  });

  it("collapses technical file details until expanded and uploads only after Review confirmation", async () => {
    renderPage();
    await scanOne();
    fireEvent.click(screen.getByRole("button", { name: "Continue to Patient" }));
    fireEvent.click(await screen.findByRole("button", { name: /John Doe/ }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Continue to Destination" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Continue to Destination" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue to Review" }));
    expect(screen.getByRole("heading", { name: "Review" })).toBeTruthy();
    expect(screen.getByText(/View DICOM file details|CD study contents/i)).toBeTruthy();
    expect(screen.queryByText(/a\.dcm/)).toBeNull();
    fireEvent.click(screen.getByText(/View DICOM file details|CD study contents/i));
    expect((await screen.findAllByText(/\.dcm/)).length).toBeGreaterThan(0);
    expect(FakeXHR.instances).toHaveLength(0);
    fireEvent.click(screen.getByRole("checkbox", { name: "I confirm this is the correct study and correct RISPro patient." }));
    fireEvent.click(screen.getByRole("button", { name: "Upload selected study, remap, and send to PACS" }));
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    expect(FakeXHR.instances[0]?.url).toBe("/api/pacs/remap/jobs/process-multipart");
  });

  it("shows truthful upload progress and backend processing stages without fabricated percentages", async () => {
    renderPage();
    await scanOne();
    fireEvent.click(screen.getByRole("button", { name: "Continue to Patient" }));
    fireEvent.click(await screen.findByRole("button", { name: /John Doe/ }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Continue to Destination" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Continue to Destination" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue to Review" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "I confirm this is the correct study and correct RISPro patient." }));
    fireEvent.click(screen.getByRole("button", { name: "Upload selected study, remap, and send to PACS" }));
    expect(await screen.findByRole("heading", { name: "Processing" })).toBeTruthy();
    expect(screen.getByText(/Sending to PACS/)).toBeTruthy();
    expect(screen.queryByText(/75%|90%/)).toBeNull();
  });

  it("keeps skipped-scan acknowledgement and warning visible", async () => {
    previewMock.mockResolvedValue({ ...result(), previewOnly: true, totalFileCount: 2, dicomLikeFileCount: 2, parsedDicomFileCount: 1 });
    scanMock.mockReturnValue(new Promise(() => undefined));
    renderPage();
    fireEvent.change(screen.getByLabelText("Select DICOM files"), { target: { files: [new File(["x"], "a.dcm")] } });
    await screen.findByText(/Detected 1 studies/i);
    const skip = screen.getByRole("button", { name: "Skip complete scan" }) as HTMLButtonElement;
    expect(skip.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /I confirm this folder is expected/i }));
    fireEvent.click(skip);
    expect(screen.getAllByText(/Folder not fully scanned/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/upload all DICOM-like candidates/i)).toBeTruthy();
  });

  it("keeps Recent Jobs secondary and requires the existing ambiguous-send confirmation", async () => {
    const job = { id: 91, status: "failed", source_orthanc_study_id: "s", modified_orthanc_study_id: "s", destination_pacs_key: "1", send_error_code: "ORTHANC_SEND_ENQUEUE_AMBIGUOUS", error_message: "RISpro could not confirm whether PACS received this study." };
    apiMock.mockImplementation((path: string) => {
      if (path === "/pacs/remap/destinations") return Promise.resolve({ destinations: [] });
      if (path === "/pacs/remap/jobs?limit=20") return Promise.resolve({ jobs: [job] });
      if (path === "/pacs/remap/jobs/91") return Promise.resolve({ job, comparison: null });
      return Promise.resolve({ appointments: [], items: [] });
    });
    renderPage();
    expect(screen.queryByText(/#91/)).toBeNull();
    fireEvent.click(screen.getByText("View recent jobs"));
    fireEvent.click(await screen.findByText(/#91/));
    expect(await screen.findByRole("heading", { name: "Processing" })).toBeTruthy();
    expect(screen.getByText(/could not confirm whether PACS received/i)).toBeTruthy();
    const resend = await waitFor(() => screen.getByRole("button", { name: "Resend to PACS" }) as HTMLButtonElement);
    expect(resend.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/I checked the destination PACS/i));
    expect(resend.disabled).toBe(false);
  });
});
