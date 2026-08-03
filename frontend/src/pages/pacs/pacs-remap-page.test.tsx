import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PacsRemapPage from "./pacs-remap-page";
import type { DicomStudyScanResult } from "@/lib/dicom-study-scan";

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
  static nextResponse: { status: number; body: unknown } | null = null;
  static autoRespond = true;
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
  abortCalled = false;
  constructor() { FakeXHR.instances.push(this); }
  open(_method: string, url: string) { this.url = url; }
  send(body?: Document | XMLHttpRequestBodyInit | null) {
    this.sentBody = body as FormData;
    this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 } as ProgressEvent<EventTarget>);
    if (FakeXHR.autoRespond) this.respond();
  }
  respond(responseOverride?: { status: number; body: unknown }) {
    this.upload.onload?.();
    const defaultResponse = this.url.endsWith("/stage-multipart")
      ? { status: 202, body: { job: { id: 88, status: "awaiting_confirmation", processing_stage: "awaiting_confirmation", staged_manifest_version: 2 } } }
      : { status: 202, body: { job: { id: 88, status: "sending" }, skippedFilesCount: 0 } };
    const response = responseOverride || FakeXHR.nextResponse || defaultResponse;
    FakeXHR.nextResponse = null;
    this.status = response.status;
    this.responseText = JSON.stringify(response.body);
    this.readyState = FakeXHR.DONE;
    this.onreadystatechange?.();
  }
  abort() {
    this.abortCalled = true;
    this.onabort?.();
  }
}

function study(uid = "1.2.3", description = "CT Chest") {
  const file = new File(["dicom"], `${description.replace(/\\s/g, "-")}.dcm`);
  const entry = {
    file,
    fileName: file.name,
    filePath: file.name,
    fileSize: file.size,
    studyInstanceUid: uid,
    seriesInstanceUid: `${uid}.series`,
    sopInstanceUid: `${uid}.sop`,
    studyDescription: description,
    studyDate: "20260101",
    modality: "CT",
    patientId: "P1",
    patientName: "One^Patient",
    patientBirthDate: "19900101",
    patientSex: "M",
  };
  return { studyInstanceUid: uid, studyDescription: description, studyDate: "20260101", modality: "CT", patientId: "P1", patientName: "One^Patient", patientBirthDate: "19900101", patientSex: "M", seriesCount: 1, fileCount: 1, totalBytes: file.size, files: [entry] };
}

type TestScanResult = Omit<DicomStudyScanResult, "studies"> & { studies: ReturnType<typeof study>[] };

function result(studies = [study()]): TestScanResult {
  return { studies, skippedSidecarCount: 0, unparsedCount: 0, totalFileCount: 1, dicomLikeFileCount: 1, parsedDicomFileCount: 1, fallbackUploadFiles: studies.flatMap((item) => item.files.map((entry) => entry.file)), unparsedFiles: [] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><PacsRemapPage /></QueryClientProvider>);
}

async function scanOne() {
  const file = new File(["x"], "a.dcm", { type: "application/dicom" });
  await waitFor(() => expect((screen.getByLabelText("Select DICOM files") as HTMLInputElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText("Select DICOM files"), { target: { files: [file] } });
  await screen.findByText(/Complete folder scan complete/i);
  return file;
}

async function reachReviewDuringUnresolvedSecureStaging() {
  FakeXHR.autoRespond = false;
  previewMock.mockResolvedValue({ ...result(), previewOnly: true });
  scanMock.mockReturnValue(new Promise(() => undefined));
  renderPage();
  await waitFor(() => expect((screen.getByLabelText("Select DICOM files") as HTMLInputElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText("Select DICOM files"), { target: { files: [new File(["x"], "a.dcm")] } });
  await screen.findByRole("button", { name: "Confirm this source study and begin secure staging" });
  fireEvent.click(screen.getByRole("checkbox", { name: /I confirm this preliminary source study/i }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm this source study and begin secure staging" }));
  fireEvent.click(await screen.findByRole("button", { name: /John Doe/ }));
  await waitFor(() => expect((screen.getByRole("button", { name: "Continue to Destination" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Continue to Destination" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue to Review" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "I confirm this is the correct study and correct RISPro patient." }));
  return {
    confirmButton: screen.getByRole("button", { name: "Confirm patient and destination; begin remap" }) as HTMLButtonElement,
    stagingRequest: FakeXHR.instances[0]!,
  };
}

describe("PacsRemapPage five-step wizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeXHR.instances.length = 0;
    FakeXHR.nextResponse = null;
    FakeXHR.autoRespond = true;
    previewMock.mockResolvedValue(result());
    scanMock.mockResolvedValue(result());
    buildPlanMock.mockReturnValue({ files: [new File(["x"], "a.dcm")], selectedStudyInstanceUid: "1.2.3", usesFallback: false });
    apiMock.mockImplementation((path: string) => {
      if (path === "/pacs/remap/destinations") return Promise.resolve({ destinations: [{ key: "1", name: "Main PACS", isDefault: true }] });
      if (path === "/pacs/remap/jobs/active") return Promise.resolve({ job: null, comparison: null });
      if (String(path).startsWith("/v2/read/appointments?dateFrom=")) return Promise.resolve({ appointments: [{ id: 201, patient_id: 10, accession_number: "ACC-1", appointment_date: "2026-01-01", modality_id: 3, modality_name_en: "CT", exam_name_en: "CT Brain", english_full_name: "John Doe", national_id: "N1" }] });
      if (path === "/pacs/remap/replacement-preview") return Promise.resolve({ replacement: { patientId: "N1", patientName: "John^Doe", patientSex: "M", patientBirthDate: "19900101" } });
      if (path === "/pacs/remap/jobs/88/confirm-staged") return Promise.resolve({ job: { id: 88, status: "uploaded", destination_pacs_key: "1", processing_stage: "queued", staged_manifest_version: 2 } });
      if (path === "/pacs/remap/jobs/88/cancel") return Promise.resolve({ job: { id: 88, status: "cancelled" } });
      if (String(path).includes("/jobs/88")) {
        const fastStaged = FakeXHR.instances.some((xhr) => xhr.url.endsWith("/stage-multipart"));
        return fastStaged
          ? Promise.resolve({ job: { id: 88, status: "awaiting_confirmation", destination_pacs_key: null, processing_stage: "awaiting_confirmation", staged_manifest_version: 2, provisional_source_identity: { studyInstanceUid: "1.2.3", patientId: "P1", patientName: "One^Patient", patientBirthDate: "19900101", patientSex: "M", modality: "CT", studyDate: "20260101" } }, comparison: null })
          : Promise.resolve({ job: { id: 88, status: "sending", destination_pacs_key: "1", processing_stage: "enqueueing_send" }, comparison: null });
      }
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

  it("does not let a background processing job auto-hijack or disable Source", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/pacs/remap/destinations") return Promise.resolve({ destinations: [] });
      if (path === "/pacs/remap/jobs/active") return Promise.resolve({ job: { id: 32, status: "processing", processing_stage: "rewriting" }, comparison: null });
      if (path === "/pacs/remap/jobs/32") return Promise.resolve({ job: { id: 32, status: "processing", processing_stage: "rewriting", staged_file_count: 4, processed_file_count: 2 }, comparison: null });
      if (String(path).includes("/pacs/remap/jobs")) return Promise.resolve({ jobs: [] });
      return Promise.resolve({ items: [] });
    });
    renderPage();
    expect(await screen.findByRole("heading", { name: "Source" })).toBeTruthy();
    expect((screen.getByLabelText("Select DICOM files") as HTMLInputElement).disabled).toBe(false);
    expect(screen.queryByText("Existing remap job #32 resumed automatically.")).toBeNull();
    expect(apiMock).not.toHaveBeenCalledWith("/pacs/remap/jobs/32");
  });

  it("shows a queued job in Recent Jobs and starting another upload does not cancel it", async () => {
    const uploadedJob = {
      id: 52,
      status: "uploaded",
      processing_stage: "queued",
      staged_manifest_version: 2,
      staged_file_count: 4,
      rispro_patient_id: 10,
      destination_pacs_key: "1",
      replacement_patient_name: "Target^Patient",
      provisional_source_identity: {
        studyInstanceUid: "1.2.52",
        patientId: "SOURCE-52",
        patientName: "Source^FiftyTwo",
        patientBirthDate: "19850102",
        patientSex: "F",
        modality: "MR",
        studyDate: "20260720",
      },
    };
    const sendingJob = { ...uploadedJob, id: 53, status: "sending", processing_stage: "enqueueing_send", orthanc_send_job_id: "orthanc-53" };
    apiMock.mockImplementation((path: string) => {
      if (path === "/pacs/remap/destinations") return Promise.resolve({ destinations: [{ key: "1", name: "Main PACS", isDefault: true }] });
      if (path === "/pacs/remap/jobs/active") return Promise.resolve({ job: uploadedJob, comparison: null });
      if (path === "/pacs/remap/jobs?limit=20") return Promise.resolve({ jobs: [uploadedJob, sendingJob] });
      if (path === "/pacs/remap/jobs/52") return Promise.resolve({ job: uploadedJob, comparison: null });
      if (path === "/pacs/remap/jobs/53") return Promise.resolve({ job: sendingJob, comparison: null });
      if (String(path).startsWith("/v2/read/appointments?dateFrom=")) return Promise.resolve({ appointments: [] });
      if (String(path).includes("/pacs/remap/jobs")) return Promise.resolve({ jobs: [] });
      return Promise.resolve({ items: [] });
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();
    expect(await screen.findByRole("heading", { name: "Source" })).toBeTruthy();
    fireEvent.click(screen.getByText("View recent jobs"));
    const queuedProgress = await screen.findByRole("progressbar", { name: /Job #52/i });
    expect(queuedProgress.getAttribute("data-state")).toBe("indeterminate");
    expect(queuedProgress.hasAttribute("aria-valuenow")).toBe(false);
    fireEvent.click(await screen.findByRole("button", { name: /#52.*Queued/i }));
    expect(await screen.findByRole("heading", { name: "Processing" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /#53.*Sending/i }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/pacs/remap/jobs/53"));
    fireEvent.click(await screen.findByRole("button", { name: "Start new upload" }));
    expect(await screen.findByRole("heading", { name: "Source" })).toBeTruthy();
    expect(apiMock).not.toHaveBeenCalledWith("/pacs/remap/jobs/52/cancel", expect.anything());
    expect(apiMock).not.toHaveBeenCalledWith("/pacs/remap/jobs/53/cancel", expect.anything());
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

  it("starts the complete scan immediately while the fast preview is pending", async () => {
    const preview = deferred<ReturnType<typeof result>>();
    previewMock.mockReturnValue(preview.promise);
    scanMock.mockReturnValue(new Promise(() => undefined));
    renderPage();
    await waitFor(() => expect((screen.getByLabelText("Select DICOM files") as HTMLInputElement).disabled).toBe(false));

    fireEvent.change(screen.getByLabelText("Select DICOM files"), { target: { files: [new File(["x"], "a.dcm")] } });

    await waitFor(() => expect(scanMock).toHaveBeenCalledTimes(1));
    expect(previewMock).toHaveBeenCalledTimes(1);
  });

  it("keeps a successful complete scan usable after a fast preview failure", async () => {
    const fullScan = deferred<ReturnType<typeof result>>();
    previewMock.mockRejectedValue(new Error("Preview API unavailable"));
    scanMock.mockReturnValue(fullScan.promise);
    renderPage();
    await waitFor(() => expect((screen.getByLabelText("Select DICOM files") as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("Select DICOM files"), { target: { files: [new File(["x"], "a.dcm")] } });

    expect(await screen.findByText("Fast preview was unavailable. RISpro is continuing the complete folder scan.")).toBeTruthy();
    expect(screen.queryByText("Preview API unavailable")).toBeNull();

    fullScan.resolve(result([study("full-study", "Complete Study")]));
    expect(await screen.findByText("Complete Study")).toBeTruthy();
    expect(screen.getByText("Complete folder scan complete")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Continue to Patient" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText("Fast preview was unavailable. RISpro is continuing the complete folder scan.")).toBeNull();
  });

  it("shows accessible complete-scan progress from processed and candidate file counts", async () => {
    const fullScan = deferred<ReturnType<typeof result>>();
    scanMock.mockImplementation((_files: File[], options: { onProgress?: (progress: unknown) => void }) => {
      options.onProgress?.({ candidateFileCount: 8, processedFileCount: 2, parsedDicomFileCount: 1, unparsedCount: 1, studyCount: 1 });
      return fullScan.promise;
    });
    renderPage();
    fireEvent.change(await screen.findByLabelText("Select DICOM files"), { target: { files: [new File(["x"], "a.dcm")] } });
    const progress = await screen.findByRole("progressbar", { name: "Complete scan progress" });
    expect(progress.getAttribute("aria-valuemin")).toBe("0");
    expect(progress.getAttribute("aria-valuemax")).toBe("100");
    expect(progress.getAttribute("aria-valuenow")).toBe("25");
    fullScan.resolve(result());
  });

  it("offers selected-study-only secure staging as soon as the local scan finds a study after preview failure", async () => {
    const fullScan = deferred<ReturnType<typeof result>>();
    let scanOptions: { signal: AbortSignal; onPartialResult?: (partial: DicomStudyScanResult) => void } | undefined;
    const selectedFile = new File(["selected"], "selected.dcm", { type: "application/dicom" });
    const otherStudyFile = new File(["other"], "other-study.dcm", { type: "application/dicom" });
    const partialStudy = study("selected-study", "Discovered Study");
    previewMock.mockRejectedValue(new Error("Preview API unavailable"));
    scanMock.mockImplementation((_files: File[], options: typeof scanOptions) => {
      scanOptions = options;
      return fullScan.promise;
    });
    buildPlanMock.mockReturnValue({ files: [selectedFile], selectedStudyInstanceUid: "selected-study", usesFallback: false });
    renderPage();
    await waitFor(() => expect((screen.getByLabelText("Select DICOM files") as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("Select DICOM files"), { target: { files: [selectedFile, otherStudyFile] } });
    await screen.findByText("Fast preview was unavailable. RISpro is continuing the complete folder scan.");

    act(() => scanOptions?.onPartialResult?.({
      ...result([partialStudy]),
      totalFileCount: 2,
      dicomLikeFileCount: 2,
      scanIncomplete: true,
    }));

    expect(await screen.findByText("Discovered Study")).toBeTruthy();
    expect(buildPlanMock).toHaveBeenCalledWith(expect.objectContaining({ scanIncomplete: true }), "selected-study", false);
    fireEvent.click(screen.getByRole("checkbox", { name: /I confirm this preliminary source study/i }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm this source study and begin secure staging" }));

    expect(scanOptions?.signal.aborted).toBe(true);
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    const stagedBody = FakeXHR.instances[0]?.sentBody;
    expect((stagedBody?.getAll("files") as File[]).map((file) => file.name)).toEqual(["selected.dcm"]);
    expect(stagedBody?.get("selectedStudyInstanceUID")).toBe("selected-study");
  });

  it("continues to the authoritative scan when the preview reports zero studies", async () => {
    previewMock.mockRejectedValue(new Error("No studies were detected in the preview."));
    scanMock.mockResolvedValue(result([study("full-study", "Usable Complete Study")]));
    renderPage();
    await waitFor(() => expect((screen.getByLabelText("Select DICOM files") as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("Select DICOM files"), { target: { files: [new File(["x"], "a.dcm")] } });

    expect(await screen.findByText("Usable Complete Study")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Continue to Patient" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText("No studies were detected in the preview.")).toBeNull();
  });

  it("does not let a late preview replace a completed full scan", async () => {
    const preview = deferred<ReturnType<typeof result>>();
    const fullScan = deferred<ReturnType<typeof result>>();
    previewMock.mockReturnValue(preview.promise);
    scanMock.mockReturnValue(fullScan.promise);
    renderPage();
    await waitFor(() => expect((screen.getByLabelText("Select DICOM files") as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("Select DICOM files"), { target: { files: [new File(["x"], "a.dcm")] } });

    fullScan.resolve(result([study("study-a", "Authoritative Study")]));
    expect(await screen.findByText("Authoritative Study")).toBeTruthy();
    preview.resolve({ ...result([study("study-b", "Late Preview Study")]), previewOnly: true });
    await waitFor(() => expect(screen.queryByText("Late Preview Study")).toBeNull());
    expect((screen.getByRole("radio") as HTMLInputElement).value).toBe("study-a");
  });

  it("ignores preview and full-scan results from a previous folder selection", async () => {
    const firstPreview = deferred<ReturnType<typeof result>>();
    const firstScan = deferred<ReturnType<typeof result>>();
    previewMock.mockReturnValueOnce(firstPreview.promise).mockResolvedValueOnce({ ...result([study("study-2", "Folder Two")]), previewOnly: true });
    scanMock.mockReturnValueOnce(firstScan.promise).mockResolvedValueOnce(result([study("study-2", "Folder Two")]));
    renderPage();
    await waitFor(() => expect((screen.getByLabelText("Select DICOM files") as HTMLInputElement).disabled).toBe(false));
    const input = screen.getByLabelText("Select DICOM files");
    fireEvent.change(input, { target: { files: [new File(["1"], "folder-one.dcm")] } });
    fireEvent.change(input, { target: { files: [new File(["2"], "folder-two.dcm")] } });

    firstPreview.resolve({ ...result([study("study-1", "Folder One")]), previewOnly: true });
    firstScan.resolve(result([study("study-1", "Folder One")]));
    expect(await screen.findByText("Folder Two")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Folder One")).toBeNull());
  });

  it("shows a terminal error only when the complete scan fails", async () => {
    previewMock.mockResolvedValue({ ...result(), previewOnly: true });
    scanMock.mockRejectedValue(new Error("Complete scan failed to read this folder."));
    renderPage();
    await waitFor(() => expect((screen.getByLabelText("Select DICOM files") as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("Select DICOM files"), { target: { files: [new File(["x"], "a.dcm")] } });

    expect((await screen.findByRole("alert")).textContent).toContain("Complete scan failed to read this folder.");
    expect(screen.getByText("Complete folder scan failed")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Continue to Patient" }) as HTMLButtonElement).disabled).toBe(true);
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

  it("does not reinterpret an upload error as a singular active-job attachment", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/pacs/remap/destinations") return Promise.resolve({ destinations: [{ key: "1", name: "Main PACS", isDefault: true }] });
      if (path === "/pacs/remap/jobs/active") return Promise.resolve({ job: null, comparison: null });
      if (path === "/pacs/remap/replacement-preview") return Promise.resolve({ replacement: { patientId: "N1", patientName: "John^Doe", patientSex: "M", patientBirthDate: "19900101" } });
      if (String(path).startsWith("/v2/read/appointments?dateFrom=")) return Promise.resolve({ appointments: [{ id: 201, patient_id: 10, english_full_name: "John Doe", national_id: "N1" }] });
      if (path === "/pacs/remap/jobs/32") return Promise.resolve({ job: { id: 32, status: "processing", processing_stage: "validating", staged_file_count: 8, processed_file_count: 1 }, comparison: null });
      if (String(path).includes("/pacs/remap/jobs")) return Promise.resolve({ jobs: [] });
      return Promise.resolve({ items: [] });
    });
    FakeXHR.nextResponse = { status: 409, body: { error: { message: "You already have an active DICOM remap job.", details: { activeJobId: 32 } } } };
    renderPage();
    await scanOne();
    fireEvent.click(screen.getByRole("button", { name: "Continue to Patient" }));
    fireEvent.click(await screen.findByRole("button", { name: /John Doe/ }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Continue to Destination" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Continue to Destination" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue to Review" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "I confirm this is the correct study and correct RISPro patient." }));
    fireEvent.click(screen.getByRole("button", { name: "Upload selected study, remap, and send to PACS" }));
    expect(await screen.findByText("You already have an active DICOM remap job.")).toBeTruthy();
    expect(FakeXHR.instances).toHaveLength(1);
    expect(apiMock).not.toHaveBeenCalledWith("/pacs/remap/jobs/32");
  });

  it("shows an actionable gateway-limit message for a multipart 413 without retrying or attaching another job", async () => {
    FakeXHR.nextResponse = { status: 413, body: "<html><body>Request Entity Too Large</body></html>" };
    renderPage();
    await scanOne();
    fireEvent.click(screen.getByRole("button", { name: "Continue to Patient" }));
    fireEvent.click(await screen.findByRole("button", { name: /John Doe/ }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Continue to Destination" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Continue to Destination" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue to Review" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "I confirm this is the correct study and correct RISPro patient." }));
    fireEvent.click(screen.getByRole("button", { name: "Upload selected study, remap, and send to PACS" }));

    expect(await screen.findByText(/exceeds the upload limit configured on the RISpro gateway/i)).toBeTruthy();
    expect(screen.getByText(/No remap job was created/i)).toBeTruthy();
    expect(screen.queryByText(/Request Entity Too Large/i)).toBeNull();
    expect(screen.queryByText(/Existing remap job #/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Start new upload" })).toBeNull();
    expect(FakeXHR.instances).toHaveLength(1);
    expect(apiMock.mock.calls.some(([path]) => path === "/pacs/remap/jobs/88")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Back to Review" }));
    expect(await screen.findByRole("heading", { name: "Review" })).toBeTruthy();
    expect(screen.getAllByText(/CT Chest/).length).toBeGreaterThan(0);
  });

  it("offers fast server verification for a preliminary selected study even when one preview sample is unparsed", async () => {
    previewMock.mockResolvedValue({ ...result(), previewOnly: true, totalFileCount: 2, dicomLikeFileCount: 2, parsedDicomFileCount: 1, unparsedCount: 1 });
    scanMock.mockReturnValue(new Promise(() => undefined));
    renderPage();
    await waitFor(() => expect((screen.getByLabelText("Select DICOM files") as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("Select DICOM files"), { target: { files: [new File(["x"], "a.dcm")] } });

    expect(await screen.findByRole("button", { name: "Confirm this source study and begin secure staging" })).toBeTruthy();
    expect(screen.getAllByText("One^Patient").length).toBeGreaterThan(0);
    expect(screen.getAllByText("P1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("19900101").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1.2.3").length).toBeGreaterThan(0);
    expect(screen.getByText(/only this Study Instance UID will be remapped and sent/i)).toBeTruthy();
  });

  it("requires explicit study selection before offering fast verification for a multi-study preview", async () => {
    previewMock.mockResolvedValue({ ...result([study("1", "First"), study("2", "Second")]), previewOnly: true });
    scanMock.mockReturnValue(new Promise(() => undefined));
    renderPage();
    await waitFor(() => expect((screen.getByLabelText("Select DICOM files") as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("Select DICOM files"), { target: { files: [new File(["x"], "a.dcm")] } });

    expect(await screen.findByText("Multiple studies detected. Select one study to remap.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirm this source study and begin secure staging" })).toBeNull();
    fireEvent.click(screen.getAllByRole("radio")[1]!);
    expect(screen.getByRole("button", { name: "Confirm this source study and begin secure staging" })).toBeTruthy();
  });

  it("fast verification cancels the complete scan and starts durable staging before patient selection", async () => {
    let resolveScan: ((value: ReturnType<typeof result>) => void) = () => undefined;
    const pendingScan = new Promise<ReturnType<typeof result>>((resolve) => { resolveScan = resolve; });
    previewMock.mockResolvedValue({ ...result(), previewOnly: true });
    scanMock.mockReturnValue(pendingScan);
    renderPage();
    await waitFor(() => expect((screen.getByLabelText("Select DICOM files") as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("Select DICOM files"), { target: { files: [new File(["x"], "a.dcm"), new File(["y"], "b.dcm")] } });
    await screen.findByRole("button", { name: "Confirm this source study and begin secure staging" });
    fireEvent.click(screen.getByRole("checkbox", { name: /I confirm this preliminary source study/i }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm this source study and begin secure staging" }));

    expect((scanMock.mock.calls[0]?.[1] as { signal: AbortSignal }).signal.aborted).toBe(true);
    expect(await screen.findByRole("heading", { name: "Patient" })).toBeTruthy();
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    expect(FakeXHR.instances[0]?.url).toBe("/api/pacs/remap/jobs/stage-multipart");
    expect(FakeXHR.instances[0]?.sentBody).toBeInstanceOf(FormData);
    expect(FakeXHR.instances[0]?.sentBody?.getAll("files")).toHaveLength(2);
    resolveScan(result([study("stale-study", "Stale")]));
    await waitFor(() => expect(screen.queryByText("Stale")).toBeNull());
  });

  it("keeps patient and destination selection usable while secure staging is still uploading", async () => {
    FakeXHR.autoRespond = false;
    previewMock.mockResolvedValue({ ...result(), previewOnly: true });
    scanMock.mockReturnValue(new Promise(() => undefined));
    renderPage();
    await waitFor(() => expect((screen.getByLabelText("Select DICOM files") as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("Select DICOM files"), { target: { files: [new File(["x"], "a.dcm")] } });
    await screen.findByRole("button", { name: "Confirm this source study and begin secure staging" });
    fireEvent.click(screen.getByRole("checkbox", { name: /I confirm this preliminary source study/i }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm this source study and begin secure staging" }));

    fireEvent.click(await screen.findByRole("button", { name: /John Doe/ }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Continue to Destination" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Continue to Destination" }));
    expect(screen.getByRole("heading", { name: "Destination" })).toBeTruthy();
    expect(screen.getByText(/Patient and destination selection remain available while the source uploads/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Continue to Review" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("records one immutable confirmation during upload and submits it once after staging returns its job ID", async () => {
    const { confirmButton, stagingRequest } = await reachReviewDuringUnresolvedSecureStaging();
    expect(confirmButton.disabled).toBe(false);
    expect(screen.getByText("You can confirm now. Processing will begin automatically when secure staging completes.")).toBeTruthy();
    const uploadProgress = screen.getByRole("progressbar", { name: "Secure source staging progress" });
    expect(uploadProgress.getAttribute("aria-valuenow")).toBe("50");
    expect(uploadProgress.getAttribute("aria-valuemin")).toBe("0");
    expect(uploadProgress.getAttribute("aria-valuemax")).toBe("100");

    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    expect(await screen.findByRole("heading", { name: "Processing" })).toBeTruthy();
    expect(screen.getByText("Confirmation recorded. Secure staging is continuing; processing will start automatically.")).toBeTruthy();
    expect(screen.getAllByText(/50%/).length).toBeGreaterThan(0);
    expect(apiMock.mock.calls.filter(([path]) => path === "/pacs/remap/jobs/88/confirm-staged")).toHaveLength(0);

    stagingRequest.respond();

    await waitFor(() => expect(apiMock.mock.calls.filter(([path]) => path === "/pacs/remap/jobs/88/confirm-staged")).toHaveLength(1));
    const confirmation = apiMock.mock.calls.find(([path]) => path === "/pacs/remap/jobs/88/confirm-staged")?.[1] as { body: string };
    expect(JSON.parse(confirmation.body)).toEqual({
      selectedStudyInstanceUID: "1.2.3",
      risproPatientId: "10",
      destinationPacsKey: "1",
      confirm: true,
    });
  });

  it("does not confirm or begin processing when pending secure staging fails", async () => {
    const { confirmButton, stagingRequest } = await reachReviewDuringUnresolvedSecureStaging();
    fireEvent.click(confirmButton);
    await screen.findByText("Confirmation recorded. Secure staging is continuing; processing will start automatically.");

    stagingRequest.respond({ status: 500, body: { error: { message: "Secure staging failed for test." } } });

    expect(await screen.findByRole("heading", { name: "Review" })).toBeTruthy();
    expect(screen.getByText("Secure staging failed for test.")).toBeTruthy();
    expect(apiMock.mock.calls.filter(([path]) => String(path).includes("/confirm-staged"))).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Cancel secure staging and reset" })).toBeTruthy();
  });

  it("reset cancels the upload and clears a pending confirmation", async () => {
    const { confirmButton, stagingRequest } = await reachReviewDuringUnresolvedSecureStaging();
    fireEvent.click(confirmButton);
    await screen.findByText("Confirmation recorded. Secure staging is continuing; processing will start automatically.");

    fireEvent.click(screen.getByRole("button", { name: "Cancel secure staging and reset" }));

    expect(stagingRequest.abortCalled).toBe(true);
    expect(await screen.findByRole("heading", { name: "Source" })).toBeTruthy();
    stagingRequest.respond();
    await act(async () => undefined);
    expect(apiMock.mock.calls.filter(([path]) => String(path).includes("/confirm-staged"))).toHaveLength(0);
  });

  it("final fast confirmation uses the small confirm-staged API without a second full-file upload", async () => {
    previewMock.mockResolvedValue({ ...result(), previewOnly: true });
    scanMock.mockReturnValue(new Promise(() => undefined));
    renderPage();
    await waitFor(() => expect((screen.getByLabelText("Select DICOM files") as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("Select DICOM files"), { target: { files: [new File(["x"], "a.dcm")] } });
    await screen.findByRole("button", { name: "Confirm this source study and begin secure staging" });
    fireEvent.click(screen.getByRole("checkbox", { name: /I confirm this preliminary source study/i }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm this source study and begin secure staging" }));
    await screen.findByText(/Complete.*awaiting final confirmation/i);
    fireEvent.click(await screen.findByRole("button", { name: /John Doe/ }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Continue to Destination" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Continue to Destination" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue to Review" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "I confirm this is the correct study and correct RISPro patient." }));
    const confirmButton = screen.getByRole("button", { name: "Confirm patient and destination; begin remap" });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      "/pacs/remap/jobs/88/confirm-staged",
      expect.objectContaining({ method: "POST" }),
    ));
    const confirmation = apiMock.mock.calls.find(([path]) => path === "/pacs/remap/jobs/88/confirm-staged")?.[1] as { body: string };
    expect(JSON.parse(confirmation.body)).toEqual({
      selectedStudyInstanceUID: "1.2.3",
      risproPatientId: "10",
      destinationPacsKey: "1",
      confirm: true,
    });
    expect(apiMock.mock.calls.filter(([path]) => path === "/pacs/remap/jobs/88/confirm-staged")).toHaveLength(1);
    expect(FakeXHR.instances).toHaveLength(1);
    expect(FakeXHR.instances[0]?.url).toBe("/api/pacs/remap/jobs/stage-multipart");
  });

  it("reset aborts an active secure staging upload", async () => {
    FakeXHR.autoRespond = false;
    previewMock.mockResolvedValue({ ...result(), previewOnly: true });
    scanMock.mockReturnValue(new Promise(() => undefined));
    renderPage();
    await waitFor(() => expect((screen.getByLabelText("Select DICOM files") as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("Select DICOM files"), { target: { files: [new File(["x"], "a.dcm")] } });
    await screen.findByRole("button", { name: "Confirm this source study and begin secure staging" });
    fireEvent.click(screen.getByRole("checkbox", { name: /I confirm this preliminary source study/i }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm this source study and begin secure staging" }));
    await screen.findByRole("heading", { name: "Patient" });
    await waitFor(() => expect(FakeXHR.instances).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Cancel secure staging and reset" }));

    expect(FakeXHR.instances[0]?.abortCalled).toBe(true);
    expect(await screen.findByRole("heading", { name: "Source" })).toBeTruthy();
  });

  it("reset cancels a completed awaiting-confirmation staging job", async () => {
    previewMock.mockResolvedValue({ ...result(), previewOnly: true });
    scanMock.mockReturnValue(new Promise(() => undefined));
    renderPage();
    await waitFor(() => expect((screen.getByLabelText("Select DICOM files") as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText("Select DICOM files"), { target: { files: [new File(["x"], "a.dcm")] } });
    await screen.findByRole("button", { name: "Confirm this source study and begin secure staging" });
    fireEvent.click(screen.getByRole("checkbox", { name: /I confirm this preliminary source study/i }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm this source study and begin secure staging" }));
    await screen.findByText(/Complete.*awaiting final confirmation/i);
    fireEvent.click(screen.getByRole("button", { name: "Cancel secure staging and reset" }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      "/pacs/remap/jobs/88/cancel",
      expect.objectContaining({ method: "POST" }),
    ));
    expect(await screen.findByRole("heading", { name: "Source" })).toBeTruthy();
  });

  it("resumes an existing awaiting-confirmation staging job at patient selection", async () => {
    const awaitingJob = {
      id: 73,
      status: "awaiting_confirmation",
      processing_stage: "awaiting_confirmation",
      staged_manifest_version: 2,
      staged_file_count: 4,
      provisional_source_identity: {
        studyInstanceUid: "1.2.73",
        patientId: "SOURCE-73",
        patientName: "Source^SeventyThree",
        patientBirthDate: "19850102",
        patientSex: "F",
        modality: "MR",
        studyDate: "20260720",
      },
    };
    apiMock.mockImplementation((path: string) => {
      if (path === "/pacs/remap/destinations") return Promise.resolve({ destinations: [{ key: "1", name: "Main PACS", isDefault: true }] });
      if (path === "/pacs/remap/jobs/active") return Promise.resolve({ job: awaitingJob, comparison: null });
      if (path === "/pacs/remap/jobs/73") return Promise.resolve({ job: awaitingJob, comparison: null });
      if (String(path).startsWith("/v2/read/appointments?dateFrom=")) return Promise.resolve({ appointments: [] });
      if (String(path).includes("/pacs/remap/jobs")) return Promise.resolve({ jobs: [] });
      return Promise.resolve({ items: [] });
    });
    renderPage();

    expect(await screen.findByRole("heading", { name: "Patient" })).toBeTruthy();
    expect(screen.getByText("Existing remap job #73 resumed automatically.")).toBeTruthy();
    expect(screen.getByText(/Complete.*awaiting final confirmation/i)).toBeTruthy();
    expect(screen.getAllByText(/Source\^SeventyThree/).length).toBeGreaterThan(0);
  });

  it("uses persisted processed and staged counts for backend processing progress", async () => {
    const job = { id: 81, status: "processing", processing_stage: "rewriting", staged_file_count: 8, processed_file_count: 2, send_attempt_count: 0 };
    apiMock.mockImplementation((path: string) => {
      if (path === "/pacs/remap/destinations") return Promise.resolve({ destinations: [] });
      if (path === "/pacs/remap/jobs/active") return Promise.resolve({ job: null, comparison: null });
      if (path === "/pacs/remap/jobs?limit=20") return Promise.resolve({ jobs: [job] });
      if (path === "/pacs/remap/jobs/81") return Promise.resolve({ job, comparison: null });
      return Promise.resolve({ appointments: [], items: [] });
    });
    renderPage();
    fireEvent.click(screen.getByText("View recent jobs"));
    fireEvent.click(await screen.findByRole("button", { name: /#81.*Processing/i }));
    const progress = await screen.findByRole("progressbar", { name: "Rewriting DICOM" });
    expect(progress.getAttribute("aria-valuenow")).toBe("25");
  });

  it("shows resend-action errors separately without hiding persisted job failure details", async () => {
    const job = { id: 82, status: "failed", processing_stage: "failed", source_orthanc_study_id: "source", modified_orthanc_study_id: "modified", destination_pacs_key: "1", error_message: "Original persisted failure", processing_error_code: "ORIGINAL_PROCESSING_ERROR", processing_error_details: { original: true }, orthanc_send_job_id: "orthanc-old", send_attempt_count: 3, send_error_code: null, send_error_details: null };
    apiMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === "/pacs/remap/destinations") return Promise.resolve({ destinations: [] });
      if (path === "/pacs/remap/jobs/active") return Promise.resolve({ job: null, comparison: null });
      if (path === "/pacs/remap/jobs?limit=20") return Promise.resolve({ jobs: [job] });
      if (path === "/pacs/remap/jobs/82") return Promise.resolve({ job, comparison: null });
      if (path === "/pacs/remap/jobs/82/resend" && options?.method === "POST") return Promise.reject(new Error("Retry transport failed"));
      return Promise.resolve({ appointments: [], items: [] });
    });
    renderPage();
    fireEvent.click(screen.getByText("View recent jobs"));
    fireEvent.click(await screen.findByRole("button", { name: /#82.*Failed/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Resend to PACS" }));
    expect(await screen.findByText("Original persisted failure")).toBeTruthy();
    const retryAlert = await screen.findByRole("alert");
    expect(retryAlert.textContent).toContain("Resend action failed");
    expect(retryAlert.textContent).toContain("Retry transport failed");
    expect(screen.getByText("ORIGINAL_PROCESSING_ERROR")).toBeTruthy();
    expect(screen.getByText("orthanc-old")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
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
    fireEvent.click(await screen.findByRole("button", { name: /#91.*Failed/i }));
    expect(await screen.findByRole("heading", { name: "Processing" })).toBeTruthy();
    expect(screen.getByText(/could not confirm whether PACS received/i)).toBeTruthy();
    const resend = await waitFor(() => screen.getByRole("button", { name: "Resend to PACS" }) as HTMLButtonElement);
    expect(resend.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/I checked the destination PACS/i));
    expect(resend.disabled).toBe(false);
  });
});
