import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import PacsRemapPage from "./pacs-remap-page";
import { ApiError } from "@/lib/api-client";
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

function renderPage(initialEntry = "/pacs/remap") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { ...render(<MemoryRouter initialEntries={[initialEntry]}><QueryClientProvider client={qc}><PacsRemapPage /></QueryClientProvider></MemoryRouter>), queryClient: qc };
}

async function scanOne() {
  const file = new File(["x"], "a.dcm", { type: "application/dicom" });
  await waitFor(() => expect((screen.getByLabelText("Select DICOM files") as HTMLInputElement).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText("Select DICOM files"), { target: { files: [file] } });
  await screen.findByText(/Complete folder scan complete/i);
  return file;
}

async function submitStandardProcessUpload() {
  await scanOne();
  fireEvent.click(screen.getByRole("button", { name: "Continue to Patient" }));
  fireEvent.click(await screen.findByRole("button", { name: /John Doe/ }));
  await waitFor(() => expect((screen.getByRole("button", { name: "Continue to Destination" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Continue to Destination" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue to Review" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "I confirm this is the correct study and correct RISPro patient." }));
  fireEvent.click(screen.getByRole("button", { name: "Upload selected study, remap, and send to PACS" }));
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

  it("uses the scoped remap patient search for All RISpro patients and selects a result", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/pacs/remap/destinations") return Promise.resolve({ destinations: [{ key: "1", name: "Main PACS", isDefault: true }] });
      if (path === "/pacs/remap/jobs/active") return Promise.resolve({ job: null, comparison: null });
      if (String(path).startsWith("/v2/read/appointments?dateFrom=")) return Promise.resolve({ appointments: [] });
      if (path === "/pacs/remap/patient-search?q=Ja") return Promise.resolve({ patients: [{ id: 42, english_full_name: "Jane Patient", national_id: "N-42", mrn: "MRN-42", sex: "F", date_of_birth: "1990-01-02" }] });
      if (path === "/pacs/remap/replacement-preview") return Promise.resolve({ replacement: { patientId: "N-42", patientName: "Jane^Patient", patientSex: "F", patientBirthDate: "19900102" } });
      if (String(path).includes("/pacs/remap/jobs")) return Promise.resolve({ jobs: [] });
      return Promise.resolve({ items: [] });
    });

    renderPage();
    await scanOne();
    fireEvent.click(screen.getByRole("button", { name: "Continue to Patient" }));
    fireEvent.change(screen.getAllByRole("combobox")[0]!, { target: { value: "all_patients" } });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Ja" } });

    const patient = await screen.findByRole("button", { name: /Jane Patient/ });
    expect(apiMock).toHaveBeenCalledWith("/pacs/remap/patient-search?q=Ja");
    expect(apiMock.mock.calls.some(([path]) => String(path).startsWith("/patients?q="))).toBe(false);
    expect(apiMock.mock.calls.some(([path]) => String(path).startsWith("/patients/directory?"))).toBe(false);

    fireEvent.click(patient);
    await waitFor(() => expect((screen.getByRole("button", { name: "Continue to Destination" }) as HTMLButtonElement).disabled).toBe(false));
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

  it("keeps Source available when multiple awaiting-confirmation drafts require explicit Recent Jobs selection", async () => {
    const awaitingDrafts = [41, 42].map((id) => ({
      id,
      status: "awaiting_confirmation",
      processing_stage: "awaiting_confirmation",
      staged_manifest_version: 2,
      staged_file_count: 2,
      provisional_source_identity: { studyInstanceUid: `1.2.${id}`, patientId: `P-${id}`, patientName: `Draft^${id}` },
    }));
    apiMock.mockImplementation((path: string) => {
      if (path === "/pacs/remap/destinations") return Promise.resolve({ destinations: [] });
      if (path === "/pacs/remap/jobs/active") return Promise.resolve({ job: null, comparison: null });
      if (path === "/pacs/remap/jobs?limit=20") return Promise.resolve({ jobs: awaitingDrafts });
      return Promise.resolve({ items: [] });
    });
    renderPage();
    expect(await screen.findByRole("heading", { name: "Source" })).toBeTruthy();
    expect((screen.getByLabelText("Select DICOM files") as HTMLInputElement).disabled).toBe(false);
    expect(screen.queryByText(/resumed automatically/i)).toBeNull();
    fireEvent.click(screen.getByText("View recent jobs"));
    expect(await screen.findByRole("button", { name: /#41.*Awaiting confirmation/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /#42.*Awaiting confirmation/i })).toBeTruthy();
  });

  it("requires explicit acknowledgement before sending a partial study and exposes only generated file labels", async () => {
    const partialJob = {
      id: 610,
      status: "awaiting_confirmation",
      processing_stage: "awaiting_send_confirmation",
      staged_manifest_version: 2,
      processed_file_count: 996,
      staged_file_count: 1000,
      processing_selection_counts: {
        acceptedUniqueInstances: 996,
        failedSelectedStudyFiles: 4,
        excludedOtherStudyFiles: 7,
        partial: true,
        completenessUncertain: false,
        completeSeriesLossCount: 1,
        failureSample: [{ fileLabel: "File 184", category: "skipped_unparseable" }],
      },
    };
    apiMock.mockImplementation((path: string, options?: { body?: string }) => {
      if (path === "/pacs/remap/destinations") return Promise.resolve({ destinations: [] });
      if (path === "/pacs/remap/jobs/active") return Promise.resolve({ job: null, comparison: null });
      if (path === "/pacs/remap/jobs?limit=20") return Promise.resolve({ jobs: [partialJob] });
      if (path === "/pacs/remap/jobs/610") return Promise.resolve({ job: partialJob, comparison: null });
      if (path === "/pacs/remap/jobs/610/confirm-send") {
        expect(JSON.parse(options?.body || "{}")).toEqual({ confirm: true, confirmIncompleteStudy: true });
        return Promise.resolve({ job: { ...partialJob, status: "sending", processing_stage: "enqueueing_send" } });
      }
      return Promise.resolve({ items: [] });
    });
    renderPage();
    fireEvent.click(await screen.findByText("#610", { exact: false }));
    expect(await screen.findByText("Partial study import")).toBeTruthy();
    expect(screen.getByText(/File 184: skipped_unparseable/)).toBeTruthy();
    const sendButton = screen.getByRole("button", { name: "Acknowledge and send to PACS" }) as HTMLButtonElement;
    expect(sendButton.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: /remapped study is incomplete/i }));
    expect(sendButton.disabled).toBe(false);
    fireEvent.click(sendButton);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/pacs/remap/jobs/610/confirm-send", expect.any(Object)));
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

  it("isolates an opened persisted job from the preserved local draft", async () => {
    const draftStudy = {
      ...study("1.2.draft-a", "Draft Study A"),
      patientId: "DRAFT-SOURCE-A",
      patientName: "Draft^SourceA",
    };
    const persistedJob = {
      id: 77,
      status: "processing",
      processing_stage: "rewriting",
      selected_study_instance_uid: "9.9.job-b",
      original_patient_id: "JOB-SOURCE-B",
      original_patient_name: "Persisted^SourceB",
      replacement_patient_id: "JOB-TARGET-B",
      replacement_patient_name: "Persisted^TargetB",
      destination_pacs_key: "DEST-B",
      staged_file_count: 8,
      processed_file_count: 4,
      send_attempt_count: 0,
    };
    previewMock.mockResolvedValue(result([draftStudy]));
    scanMock.mockResolvedValue(result([draftStudy]));
    apiMock.mockImplementation((path: string) => {
      if (path === "/pacs/remap/destinations") return Promise.resolve({ destinations: [
        { key: "DEST-A", name: "Draft Destination A" },
        { key: "DEST-B", name: "Persisted Destination B" },
      ] });
      if (path === "/pacs/remap/jobs/active") return Promise.resolve({ job: null, comparison: null });
      if (path === "/pacs/remap/jobs?limit=20") return Promise.resolve({ jobs: [persistedJob] });
      if (path === "/pacs/remap/jobs/77") return Promise.resolve({ job: persistedJob, comparison: null });
      if (String(path).startsWith("/v2/read/appointments?dateFrom=")) return Promise.resolve({ appointments: [{ id: 301, patient_id: 31, appointment_date: "2026-01-01", english_full_name: "Draft Patient A", national_id: "DRAFT-A" }] });
      if (path === "/pacs/remap/replacement-preview") return Promise.resolve({ replacement: { patientId: "DRAFT-A", patientName: "Draft^PatientA", patientSex: "F", patientBirthDate: "19920202" } });
      return Promise.resolve({ items: [] });
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderPage();
    await scanOne();
    fireEvent.click(screen.getByRole("button", { name: "Continue to Patient" }));
    fireEvent.click(await screen.findByRole("button", { name: /Draft Patient A/ }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Continue to Destination" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Continue to Destination" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "DEST-A" } });

    const draftSummary = screen.getByLabelText("Selection summary");
    expect(draftSummary.textContent).toContain("Draft Study A");
    expect(draftSummary.textContent).toContain("Draft Patient A");
    expect(draftSummary.textContent).toContain("Draft Destination A");

    fireEvent.click(screen.getByText("View recent jobs"));
    fireEvent.click(await screen.findByRole("button", { name: /#77.*Processing/i }));
    expect(await screen.findByRole("heading", { name: "Processing" })).toBeTruthy();

    const persistedContext = await screen.findByLabelText("Persisted job context");
    const persistedSummary = screen.getByLabelText("Selection summary");
    expect(persistedContext.textContent).toContain("Persisted^SourceB");
    expect(persistedContext.textContent).toContain("Persisted^TargetB");
    expect(persistedContext.textContent).toContain("9.9.job-b");
    expect(persistedContext.textContent).toContain("Persisted Destination B");
    expect(persistedSummary.textContent).toContain("9.9.job-b");
    expect(persistedSummary.textContent).toContain("Persisted^TargetB");
    expect(persistedSummary.textContent).toContain("Persisted Destination B");
    expect(`${persistedContext.textContent} ${persistedSummary.textContent}`).not.toMatch(/Draft Study A|Draft Patient A|Draft\^SourceA|Draft Destination A|1\.2\.draft-a/);
    expect(screen.getByRole("progressbar", { name: "Rewriting DICOM" }).getAttribute("aria-valuenow")).toBe("50");
    expect(screen.getByText(/Job status: Processing/).textContent).toContain("4/8");

    fireEvent.click(screen.getByRole("button", { name: "Start new upload" }));
    expect(await screen.findByRole("heading", { name: "Destination" })).toBeTruthy();
    const restoredSummary = screen.getByLabelText("Selection summary");
    expect(restoredSummary.textContent).toContain("Draft Study A");
    expect(restoredSummary.textContent).toContain("Draft Patient A");
    expect(restoredSummary.textContent).toContain("Draft Destination A");
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("DEST-A");
    expect(apiMock).not.toHaveBeenCalledWith("/pacs/remap/jobs/77/cancel", expect.anything());
  });

  it("keeps Recent Job B displayed when secure staging for workflow A resolves, then restores A", async () => {
    FakeXHR.autoRespond = false;
    const workflowStudy = { ...study("1.2.workflow-a", "Workflow Study A"), patientName: "Workflow^SourceA" };
    const workflowJob = {
      id: 88,
      status: "awaiting_confirmation",
      processing_stage: "awaiting_confirmation",
      staged_manifest_version: 2,
      selected_study_instance_uid: "1.2.workflow-a",
      staged_file_count: 1,
      provisional_source_identity: { studyInstanceUid: "1.2.workflow-a", patientId: "A-SOURCE", patientName: "Workflow^SourceA", patientBirthDate: "19900101", patientSex: "M", modality: "CT", studyDate: "20260101" },
    };
    const viewedJob = {
      id: 202,
      status: "processing",
      processing_stage: "rewriting",
      selected_study_instance_uid: "9.9.viewed-b",
      original_patient_id: "B-SOURCE",
      original_patient_name: "Viewed^SourceB",
      replacement_patient_id: "B-TARGET",
      replacement_patient_name: "Viewed^TargetB",
      destination_pacs_key: "DEST-B",
      staged_file_count: 10,
      processed_file_count: 5,
      send_attempt_count: 0,
    };
    previewMock.mockResolvedValue({ ...result([workflowStudy]), previewOnly: true });
    scanMock.mockReturnValue(new Promise(() => undefined));
    apiMock.mockImplementation((path: string) => {
      if (path === "/pacs/remap/destinations") return Promise.resolve({ destinations: [{ key: "DEST-B", name: "Viewed Destination B" }] });
      if (path === "/pacs/remap/jobs/active") return Promise.resolve({ job: null, comparison: null });
      if (path === "/pacs/remap/jobs?limit=20") return Promise.resolve({ jobs: [viewedJob] });
      if (path === "/pacs/remap/jobs/202") return Promise.resolve({ job: viewedJob, comparison: null });
      if (path === "/pacs/remap/jobs/88") return Promise.resolve({ job: workflowJob, comparison: null });
      return Promise.resolve({ appointments: [], items: [] });
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderPage();
    fireEvent.change(await screen.findByLabelText("Select DICOM files"), { target: { files: [new File(["a"], "a.dcm")] } });
    await screen.findByRole("button", { name: "Confirm this source study and begin secure staging" });
    fireEvent.click(screen.getByRole("checkbox", { name: /I confirm this preliminary source study/i }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm this source study and begin secure staging" }));
    await screen.findByRole("heading", { name: "Patient" });
    fireEvent.click(screen.getByText("View recent jobs"));
    fireEvent.click(await screen.findByRole("button", { name: /#202.*Processing/i }));
    expect((await screen.findByLabelText("Persisted job context")).textContent).toContain("Viewed^SourceB");

    FakeXHR.instances[0]!.respond();
    await act(async () => undefined);
    const stillViewed = screen.getByLabelText("Persisted job context");
    expect(stillViewed.textContent).toContain("Viewed^SourceB");
    expect(stillViewed.textContent).toContain("Viewed^TargetB");
    expect(stillViewed.textContent).toContain("9.9.viewed-b");
    expect(stillViewed.textContent).toContain("Viewed Destination B");
    expect(screen.queryByText("Workflow Study A")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Start new upload" }));
    expect(await screen.findByRole("heading", { name: "Patient" })).toBeTruthy();
    expect(screen.getByLabelText("Selection summary").textContent).toContain("Workflow Study A");
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/pacs/remap/jobs/88"));
    expect(apiMock).not.toHaveBeenCalledWith("/pacs/remap/jobs/202/cancel", expect.anything());
  });

  it("restores processing workflow A and its query after viewing Recent Job B", async () => {
    const workflowJob = { id: 88, status: "processing", processing_stage: "rewriting", staged_file_count: 6, processed_file_count: 2, send_attempt_count: 0 };
    const viewedJob = { id: 203, status: "sending", processing_stage: "enqueueing_send", selected_study_instance_uid: "9.9.203", original_patient_name: "Viewed^B", replacement_patient_name: "Target^B", destination_pacs_key: "DEST-B", staged_file_count: 4, processed_file_count: 4, send_attempt_count: 1 };
    apiMock.mockImplementation((path: string) => {
      if (path === "/pacs/remap/destinations") return Promise.resolve({ destinations: [{ key: "DEST-A", name: "Workflow Destination A", isDefault: true }, { key: "DEST-B", name: "Viewed Destination B" }] });
      if (path === "/pacs/remap/jobs/active") return Promise.resolve({ job: null, comparison: null });
      if (path === "/pacs/remap/jobs?limit=20") return Promise.resolve({ jobs: [viewedJob] });
      if (path === "/pacs/remap/jobs/88") return Promise.resolve({ job: workflowJob, comparison: null });
      if (path === "/pacs/remap/jobs/203") return Promise.resolve({ job: viewedJob, comparison: null });
      if (String(path).startsWith("/v2/read/appointments?dateFrom=")) return Promise.resolve({ appointments: [{ id: 201, patient_id: 10, appointment_date: "2026-01-01", english_full_name: "Workflow Patient A" }] });
      if (path === "/pacs/remap/replacement-preview") return Promise.resolve({ replacement: { patientId: "A", patientName: "Workflow^PatientA", patientSex: "M", patientBirthDate: "19900101" } });
      return Promise.resolve({ items: [] });
    });
    renderPage();
    await scanOne();
    fireEvent.click(screen.getByRole("button", { name: "Continue to Patient" }));
    fireEvent.click(await screen.findByRole("button", { name: /Workflow Patient A/ }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Continue to Destination" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Continue to Destination" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue to Review" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "I confirm this is the correct study and correct RISPro patient." }));
    fireEvent.click(screen.getByRole("button", { name: "Upload selected study, remap, and send to PACS" }));
    expect(await screen.findByRole("heading", { name: "Processing" })).toBeTruthy();
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/pacs/remap/jobs/88"));

    fireEvent.click(screen.getByText("View recent jobs"));
    fireEvent.click(await screen.findByRole("button", { name: /#203.*Sending/i }));
    expect((await screen.findByLabelText("Persisted job context")).textContent).toContain("Viewed^B");
    const workflowQueriesBeforeReturn = apiMock.mock.calls.filter(([path]) => path === "/pacs/remap/jobs/88").length;
    fireEvent.click(screen.getByRole("button", { name: "Start new upload" }));
    expect(await screen.findByRole("heading", { name: "Processing" })).toBeTruthy();
    await waitFor(() => expect(apiMock.mock.calls.filter(([path]) => path === "/pacs/remap/jobs/88").length).toBeGreaterThan(workflowQueriesBeforeReturn));
    expect(screen.getByRole("progressbar", { name: "Rewriting DICOM" }).getAttribute("aria-valuenow")).toBe("33");
    expect(apiMock).not.toHaveBeenCalledWith("/pacs/remap/jobs/203/cancel", expect.anything());
    expect(apiMock).not.toHaveBeenCalledWith("/pacs/remap/jobs/203/reset", expect.anything());
  });

  it("clears an unavailable viewed job even when another awaiting-confirmation job exists", async () => {
    const missingJob = { id: 204, status: "processing", processing_stage: "rewriting", staged_file_count: 4, processed_file_count: 1 };
    const unrelatedAwaitingJob = { id: 205, status: "awaiting_confirmation", processing_stage: "awaiting_confirmation", staged_manifest_version: 2, staged_file_count: 2 };
    let activeJobRequests = 0;
    apiMock.mockImplementation((path: string) => {
      if (path === "/pacs/remap/destinations") return Promise.resolve({ destinations: [] });
      if (path === "/pacs/remap/jobs/active") {
        activeJobRequests += 1;
        return Promise.resolve({ job: activeJobRequests === 1 ? null : unrelatedAwaitingJob, comparison: null });
      }
      if (path === "/pacs/remap/jobs?limit=20") return Promise.resolve({ jobs: [missingJob] });
      if (path === "/pacs/remap/jobs/204") return Promise.reject(new ApiError("Job 204 no longer exists", 404));
      return Promise.resolve({ appointments: [], items: [] });
    });

    renderPage();
    fireEvent.click(screen.getByText("View recent jobs"));
    fireEvent.click(await screen.findByRole("button", { name: /#204.*Processing/i }));

    expect(await screen.findByRole("heading", { name: "Source" })).toBeTruthy();
    expect(screen.getAllByText("The existing remap job is no longer available. You may start a new upload.").length).toBeGreaterThan(0);
    expect(activeJobRequests).toBeGreaterThan(1);
    expect(screen.queryByText(/Existing remap job #205 resumed automatically/)).toBeNull();
  });

  it("fully clears a missing auto-resumed staged workflow before a fresh upload", async () => {
    const awaitingJob = {
      id: 206,
      status: "awaiting_confirmation",
      processing_stage: "awaiting_confirmation",
      staged_manifest_version: 2,
      staged_file_count: 3,
      provisional_source_identity: { studyInstanceUid: "1.2.206", patientId: "SOURCE-206", patientName: "Missing^Source", modality: "CT" },
    };
    let activeJobRequests = 0;
    let jobRequests = 0;
    apiMock.mockImplementation((path: string) => {
      if (path === "/pacs/remap/destinations") return Promise.resolve({ destinations: [{ key: "MISSING-DEST", name: "Missing Destination" }, { key: "OTHER-DEST", name: "Other Destination" }] });
      if (path === "/pacs/remap/jobs/active") {
        activeJobRequests += 1;
        return Promise.resolve({ job: activeJobRequests === 1 ? awaitingJob : null, comparison: null });
      }
      if (path === "/pacs/remap/jobs?limit=20") return Promise.resolve({ jobs: [] });
      if (path === "/pacs/remap/jobs/206") {
        jobRequests += 1;
        return jobRequests === 1
          ? Promise.resolve({ job: awaitingJob, comparison: null })
          : Promise.reject(new ApiError("Job 206 no longer exists", 404));
      }
      if (String(path).startsWith("/v2/read/appointments?dateFrom=")) return Promise.resolve({ appointments: [{ id: 801, patient_id: 44, appointment_date: "2026-01-01", english_full_name: "Missing Job Patient" }] });
      if (path === "/pacs/remap/replacement-preview") return Promise.resolve({ replacement: { patientId: "TARGET-44", patientName: "Missing^Target", patientSex: "F", patientBirthDate: "19900101" } });
      return Promise.resolve({ items: [] });
    });

    const { queryClient } = renderPage();
    expect(await screen.findByRole("heading", { name: "Patient" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /Missing Job Patient/ }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Continue to Destination" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Continue to Destination" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "MISSING-DEST" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue to Review" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "I confirm this is the correct study and correct RISPro patient." }));

    await queryClient.invalidateQueries({ queryKey: ["pacs", "remap", "job", 206] });
    expect(await screen.findByRole("heading", { name: "Source" })).toBeTruthy();
    const clearedSummary = screen.getByLabelText("Selection summary");
    expect(clearedSummary.textContent).not.toMatch(/1\.2\.206|Missing Job Patient|Missing Destination/);
    expect(screen.queryByRole("checkbox", { name: "I confirm this is the correct study and correct RISPro patient." })).toBeNull();
    expect(screen.queryByText("Secure source staging")).toBeNull();
    expect((screen.getByLabelText("Select DICOM files") as HTMLInputElement).disabled).toBe(false);

    fireEvent.change(screen.getByLabelText("Select DICOM files"), { target: { files: [new File(["fresh"], "fresh.dcm", { type: "application/dicom" })] } });
    expect(await screen.findByText(/Complete folder scan complete/i)).toBeTruthy();
  });

  it("automatically retries an uncached resumed job after a transient retrieval error", async () => {
    vi.useFakeTimers();
    try {
      const awaitingJob = { id: 207, status: "awaiting_confirmation", processing_stage: "awaiting_confirmation", staged_manifest_version: 2, staged_file_count: 2, provisional_source_identity: { studyInstanceUid: "1.2.207", patientId: "SOURCE-207", patientName: "Transient^Source", modality: "CT" } };
      let retrievalFails = true;
      let jobRequests = 0;
      apiMock.mockImplementation((path: string) => {
        if (path === "/pacs/remap/destinations") return Promise.resolve({ destinations: [{ key: "DEST-207", name: "Transient Destination" }] });
        if (path === "/pacs/remap/jobs/active") return Promise.resolve({ job: awaitingJob, comparison: null });
        if (path === "/pacs/remap/jobs?limit=20") return Promise.resolve({ jobs: [] });
        if (path === "/pacs/remap/jobs/207") {
          jobRequests += 1;
          return retrievalFails
            ? Promise.reject(new ApiError("Temporary gateway failure", 500))
            : Promise.resolve({ job: awaitingJob, comparison: null });
        }
        return Promise.resolve({ appointments: [], items: [] });
      });

      renderPage();
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });

      expect(screen.getByRole("alert").textContent).toContain("Temporary gateway failure");
      expect(screen.getByLabelText("Selection summary").textContent).toContain("1.2.207");

      retrievalFails = false;
      const failedRequestCount = jobRequests;
      await act(async () => { await vi.advanceTimersByTimeAsync(4_900); });
      expect(jobRequests).toBe(failedRequestCount);
      expect(screen.getByRole("alert").textContent).toContain("Temporary gateway failure");

      await act(async () => { await vi.advanceTimersByTimeAsync(200); });
      expect(jobRequests).toBeGreaterThan(failedRequestCount);
      expect(screen.queryByText(/Temporary gateway failure/)).toBeNull();
      expect(screen.getByRole("heading", { name: "Patient" })).toBeTruthy();
      expect(screen.getByLabelText("Selection summary").textContent).toContain("1.2.207");
    } finally {
      vi.useRealTimers();
    }
  });

  it("isolates awaiting-confirmation Job B selections and restores local Draft A after confirmation", async () => {
    const draftStudy = { ...study("1.2.draft-a", "Draft Study A"), patientName: "Draft^SourceA" };
    let stagedJob = {
      id: 302,
      status: "awaiting_confirmation",
      processing_stage: "awaiting_confirmation",
      staged_manifest_version: 2,
      selected_study_instance_uid: "9.9.staged-b",
      staged_file_count: 3,
      provisional_source_identity: { studyInstanceUid: "9.9.staged-b", patientId: "B-SOURCE", patientName: "Staged^SourceB", patientBirthDate: "19880202", patientSex: "F", modality: "MR", studyDate: "20260720" },
      destination_pacs_key: null as string | null,
      rispro_patient_id: null as number | null,
    };
    let confirmedBody: Record<string, unknown> | null = null;
    previewMock.mockResolvedValue(result([draftStudy]));
    scanMock.mockResolvedValue(result([draftStudy]));
    apiMock.mockImplementation((path: string, options?: { method?: string; body?: string }) => {
      if (path === "/pacs/remap/destinations") return Promise.resolve({ destinations: [{ key: "DEST-A", name: "Draft Destination A" }, { key: "DEST-B", name: "Staged Destination B" }] });
      if (path === "/pacs/remap/jobs/active") return Promise.resolve({ job: null, comparison: null });
      if (path === "/pacs/remap/jobs?limit=20") return Promise.resolve({ jobs: [stagedJob] });
      if (path === "/pacs/remap/jobs/302") return Promise.resolve({ job: stagedJob, comparison: null });
      if (path === "/pacs/remap/jobs/302/confirm-staged" && options?.method === "POST") {
        confirmedBody = JSON.parse(options.body || "{}");
        stagedJob = { ...stagedJob, status: "uploaded", processing_stage: "queued", rispro_patient_id: 20, destination_pacs_key: "DEST-B" };
        return Promise.resolve({ job: stagedJob });
      }
      if (String(path).startsWith("/v2/read/appointments?dateFrom=")) return Promise.resolve({ appointments: [
        { id: 401, patient_id: 10, appointment_date: "2026-01-01", english_full_name: "Draft Patient A" },
        { id: 402, patient_id: 20, appointment_date: "2026-01-01", english_full_name: "Staged Patient B" },
      ] });
      if (path === "/pacs/remap/replacement-preview") {
        const patientId = JSON.parse(options?.body || "{}").risproPatientId;
        return Promise.resolve({ replacement: { patientId: patientId === "20" ? "B" : "A", patientName: patientId === "20" ? "Staged^PatientB" : "Draft^PatientA", patientSex: "F", patientBirthDate: "19900101" } });
      }
      return Promise.resolve({ items: [] });
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderPage();
    await scanOne();
    fireEvent.click(screen.getByRole("button", { name: "Continue to Patient" }));
    fireEvent.click(await screen.findByRole("button", { name: /Draft Patient A/ }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Continue to Destination" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Continue to Destination" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "DEST-A" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue to Review" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "I confirm this is the correct study and correct RISPro patient." }));

    fireEvent.click(screen.getByText("View recent jobs"));
    fireEvent.click(await screen.findByRole("button", { name: /#302.*Awaiting confirmation/i }));
    expect(await screen.findByRole("heading", { name: "Patient" })).toBeTruthy();
    const stagedSummary = screen.getByLabelText("Selection summary");
    expect(stagedSummary.textContent).toContain("9.9.staged-b");
    expect(stagedSummary.textContent).not.toMatch(/Draft Patient A|Draft Destination A|Draft Study A/);
    expect((screen.getByRole("button", { name: "Continue to Destination" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /Staged Patient B/ }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Continue to Destination" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Continue to Destination" }));
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "DEST-B" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue to Review" }));
    const stagedConfirmation = screen.getByRole("checkbox", { name: "I confirm this is the correct study and correct RISPro patient." }) as HTMLInputElement;
    expect(stagedConfirmation.checked).toBe(false);
    fireEvent.click(stagedConfirmation);
    fireEvent.click(screen.getByRole("button", { name: "Confirm patient and destination; begin remap" }));
    await waitFor(() => expect(confirmedBody).toEqual({ selectedStudyInstanceUID: "9.9.staged-b", risproPatientId: "20", destinationPacsKey: "DEST-B", confirm: true }));

    fireEvent.click(await screen.findByRole("button", { name: "Start new upload" }));
    expect(await screen.findByRole("heading", { name: "Review" })).toBeTruthy();
    const restoredSummary = screen.getByLabelText("Selection summary");
    expect(restoredSummary.textContent).toContain("Draft Study A");
    expect(restoredSummary.textContent).toContain("Draft Patient A");
    expect(restoredSummary.textContent).toContain("Draft Destination A");
    expect((screen.getByRole("checkbox", { name: "I confirm this is the correct study and correct RISPro patient." }) as HTMLInputElement).checked).toBe(true);
    const stagedConfirmationCalls = apiMock.mock.calls.filter(([path]) => path === "/pacs/remap/jobs/302/confirm-staged").length;
    const normalProcessButton = screen.getByRole("button", { name: "Upload selected study, remap, and send to PACS" });
    fireEvent.click(normalProcessButton);
    await waitFor(() => expect(FakeXHR.instances.some((xhr) => xhr.url === "/api/pacs/remap/jobs/process-multipart")).toBe(true));
    expect(apiMock.mock.calls.filter(([path]) => path === "/pacs/remap/jobs/302/confirm-staged")).toHaveLength(stagedConfirmationCalls);
    expect(screen.queryByText("Secure staging job is not available.")).toBeNull();
  });

  it("keeps awaiting-confirmation selections scoped when switching between Jobs B and C", async () => {
    const stagedJob = (id: number, uid: string, sourceName: string) => ({ id, status: "awaiting_confirmation", processing_stage: "awaiting_confirmation", staged_manifest_version: 2, selected_study_instance_uid: uid, staged_file_count: 2, provisional_source_identity: { studyInstanceUid: uid, patientId: `SOURCE-${id}`, patientName: sourceName, patientBirthDate: "19900101", patientSex: "M", modality: "CT", studyDate: "20260101" }, destination_pacs_key: null, rispro_patient_id: null });
    const jobB = stagedJob(401, "9.9.job-b", "Source^B");
    const jobC = stagedJob(402, "9.9.job-c", "Source^C");
    apiMock.mockImplementation((path: string) => {
      if (path === "/pacs/remap/destinations") return Promise.resolve({ destinations: [{ key: "DEST-B", name: "Destination B" }, { key: "DEST-C", name: "Destination C" }] });
      if (path === "/pacs/remap/jobs/active") return Promise.resolve({ job: null, comparison: null });
      if (path === "/pacs/remap/jobs?limit=20") return Promise.resolve({ jobs: [jobB, jobC] });
      if (path === "/pacs/remap/jobs/401") return Promise.resolve({ job: jobB, comparison: null });
      if (path === "/pacs/remap/jobs/402") return Promise.resolve({ job: jobC, comparison: null });
      if (String(path).startsWith("/v2/read/appointments?dateFrom=")) return Promise.resolve({ appointments: [{ id: 501, patient_id: 21, appointment_date: "2026-01-01", english_full_name: "Patient B" }, { id: 502, patient_id: 22, appointment_date: "2026-01-01", english_full_name: "Patient C" }] });
      if (path === "/pacs/remap/replacement-preview") return Promise.resolve({ replacement: { patientId: "B", patientName: "Patient^B", patientSex: "M", patientBirthDate: "19900101" } });
      return Promise.resolve({ items: [] });
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();
    fireEvent.click(screen.getByText("View recent jobs"));
    fireEvent.click(await screen.findByRole("button", { name: /#401.*Awaiting confirmation/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Patient B/ }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Continue to Destination" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Continue to Destination" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "DEST-B" } });

    fireEvent.click(screen.getByRole("button", { name: /#402.*Awaiting confirmation/i }));
    expect(await screen.findByRole("heading", { name: "Patient" })).toBeTruthy();
    expect(screen.getByLabelText("Selection summary").textContent).toContain("9.9.job-c");
    expect(screen.getByLabelText("Selection summary").textContent).not.toMatch(/Patient B|Destination B|9\.9\.job-b/);
    expect((screen.getByRole("button", { name: "Continue to Destination" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /#401.*Awaiting confirmation/i }));
    expect(await screen.findByRole("heading", { name: "Patient" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Continue to Destination" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Continue to Destination" }));
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("DEST-B");
  });

  it.each(["success", "failure"] as const)("binds direct Recent Job resend %s to Job B and restores Draft A", async (outcome) => {
    const draftStudy = study("1.2.resend-draft-a", "Resend Draft A");
    let recentJob = { id: 502, status: "failed", processing_stage: "failed", source_orthanc_study_id: "source-b", modified_orthanc_study_id: "modified-b", selected_study_instance_uid: "9.9.resend-b", original_patient_name: "Resend^SourceB", replacement_patient_name: "Resend^TargetB", destination_pacs_key: "DEST-B", orthanc_send_job_id: null as string | null, error_message: "Original Job B failure", staged_file_count: 5, processed_file_count: 5, send_attempt_count: 2, send_error_code: "ORTHANC_SEND_JOB_FAILED", dicom_integrity_version: 1, dicom_integrity_verified_at: "2026-08-13T00:00:00.000Z" };
    previewMock.mockResolvedValue(result([draftStudy]));
    scanMock.mockResolvedValue(result([draftStudy]));
    apiMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === "/pacs/remap/destinations") return Promise.resolve({ destinations: [{ key: "DEST-A", name: "Draft Destination A" }, { key: "DEST-B", name: "Resend Destination B" }] });
      if (path === "/pacs/remap/jobs/active") return Promise.resolve({ job: null, comparison: null });
      if (path === "/pacs/remap/jobs?limit=20") return Promise.resolve({ jobs: [recentJob] });
      if (path === "/pacs/remap/jobs/502") return Promise.resolve({ job: recentJob, comparison: null });
      if (path === "/pacs/remap/jobs/502/resend" && options?.method === "POST") {
        if (outcome === "failure") return Promise.reject(new Error("Resend B transport failure"));
        recentJob = { ...recentJob, status: "sending", processing_stage: "enqueueing_send", orthanc_send_job_id: "orthanc-b" };
        return Promise.resolve({ job: recentJob });
      }
      if (String(path).startsWith("/v2/read/appointments?dateFrom=")) return Promise.resolve({ appointments: [{ id: 601, patient_id: 31, appointment_date: "2026-01-01", english_full_name: "Resend Draft Patient A" }] });
      if (path === "/pacs/remap/replacement-preview") return Promise.resolve({ replacement: { patientId: "A", patientName: "Resend^DraftA", patientSex: "F", patientBirthDate: "19900101" } });
      return Promise.resolve({ items: [] });
    });

    renderPage();
    await scanOne();
    fireEvent.click(screen.getByRole("button", { name: "Continue to Patient" }));
    fireEvent.click(await screen.findByRole("button", { name: /Resend Draft Patient A/ }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Continue to Destination" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Continue to Destination" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "DEST-A" } });
    fireEvent.click(screen.getByText("View recent jobs"));
    fireEvent.click(await screen.findByRole("button", { name: "Resend to PACS" }));

    expect(await screen.findByRole("heading", { name: "Processing" })).toBeTruthy();
    const persistedContext = await screen.findByLabelText("Persisted job context");
    expect(persistedContext.textContent).toContain("Resend^SourceB");
    expect(persistedContext.textContent).toContain("Resend^TargetB");
    expect(persistedContext.textContent).toContain("9.9.resend-b");
    expect(persistedContext.textContent).toContain("Resend Destination B");
    expect(screen.getByLabelText("Selection summary").textContent).not.toMatch(/Resend Draft A|Resend Draft Patient A|Draft Destination A/);
    expect(screen.getAllByText("Original Job B failure").length).toBeGreaterThan(0);
    if (outcome === "failure") expect((await screen.findByRole("alert")).textContent).toContain("Resend B transport failure");
    else await waitFor(() => expect(screen.getByText(/Job status: Sending/)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Start new upload" }));
    expect(await screen.findByRole("heading", { name: "Destination" })).toBeTruthy();
    const restoredSummary = screen.getByLabelText("Selection summary");
    expect(restoredSummary.textContent).toContain("Resend Draft A");
    expect(restoredSummary.textContent).toContain("Resend Draft Patient A");
    expect(restoredSummary.textContent).toContain("Draft Destination A");
    expect(apiMock).not.toHaveBeenCalledWith("/pacs/remap/jobs/502/cancel", expect.anything());
  });

  it("polls Recent Jobs only while background work is non-terminal and refreshes progress without opening it", async () => {
    vi.useFakeTimers();
    try {
      let jobsRequestCount = 0;
      apiMock.mockImplementation((path: string) => {
        if (path === "/pacs/remap/destinations") return Promise.resolve({ destinations: [] });
        if (path === "/pacs/remap/jobs/active") return Promise.resolve({ job: null, comparison: null });
        if (path === "/pacs/remap/jobs?limit=20") {
          jobsRequestCount += 1;
          const job = jobsRequestCount === 1
            ? { id: 78, status: "processing", processing_stage: "rewriting", staged_file_count: 4, processed_file_count: 1 }
            : jobsRequestCount === 2
              ? { id: 78, status: "processing", processing_stage: "rewriting", staged_file_count: 4, processed_file_count: 3 }
              : { id: 78, status: "sent", processing_stage: "completed", staged_file_count: 4, processed_file_count: 4 };
          return Promise.resolve({ jobs: [job] });
        }
        return Promise.resolve({ items: [] });
      });

      renderPage();
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      fireEvent.click(screen.getByText("View recent jobs"));
      expect(screen.getByRole("progressbar", { name: /Job #78/i }).getAttribute("aria-valuenow")).toBe("25");
      expect(screen.getByRole("heading", { name: "Source" })).toBeTruthy();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_100);
        await Promise.resolve();
      });
      expect(jobsRequestCount).toBe(2);
      expect(screen.getByRole("progressbar", { name: /Job #78/i }).getAttribute("aria-valuenow")).toBe("75");
      expect(screen.getByRole("heading", { name: "Source" })).toBeTruthy();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_100);
        await Promise.resolve();
      });
      expect(screen.getByRole("progressbar", { name: /Job #78/i }).getAttribute("aria-valuenow")).toBe("100");
      const terminalRequestCount = jobsRequestCount;
      await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
      expect(jobsRequestCount).toBe(terminalRequestCount);
      expect(apiMock).not.toHaveBeenCalledWith("/pacs/remap/jobs/78");
      expect(screen.getByRole("heading", { name: "Source" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
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

  it.each([["93", "numeric-string"], [93, "numeric"]])("accepts a %s multipart job ID and polls the normalized job", async (jobId) => {
    const job = { id: jobId, status: "processing", processing_stage: "uploading_to_orthanc", staged_file_count: 5425, processed_file_count: 4 };
    apiMock.mockImplementation((path: string) => {
      if (path === "/pacs/remap/destinations") return Promise.resolve({ destinations: [{ key: "1", name: "Main PACS", isDefault: true }] });
      if (path === "/pacs/remap/jobs/active") return Promise.resolve({ job: null, comparison: null });
      if (path === "/pacs/remap/jobs?limit=20") return Promise.resolve({ jobs: [] });
      if (path === "/pacs/remap/jobs/93") return Promise.resolve({ job, comparison: null });
      if (String(path).startsWith("/v2/read/appointments?dateFrom=")) return Promise.resolve({ appointments: [{ id: 201, patient_id: 10, english_full_name: "John Doe", national_id: "N1" }] });
      if (path === "/pacs/remap/replacement-preview") return Promise.resolve({ replacement: { patientId: "N1", patientName: "John^Doe", patientSex: "M", patientBirthDate: "19900101" } });
      return Promise.resolve({ items: [] });
    });
    FakeXHR.nextResponse = { status: 202, body: { job } };

    renderPage();
    await submitStandardProcessUpload();

    expect(await screen.findByRole("heading", { name: "Processing" })).toBeTruthy();
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/pacs/remap/jobs/93"));
    expect(screen.queryByText("Upload response is missing a valid job ID.")).toBeNull();
    expect(apiMock.mock.calls.some(([path]) => /\/pacs\/remap\/jobs\/(?:null|undefined|NaN|\[object Object\])(?:$|\/)/.test(String(path)))).toBe(false);
  });

  it.each([null, "null", 0, "0", "abc", "1.5", "9007199254740992"])("rejects invalid multipart job ID %s without a current-job request", async (jobId) => {
    FakeXHR.nextResponse = { status: 202, body: { job: { id: jobId, status: "uploaded" } } };
    renderPage();

    await submitStandardProcessUpload();

    expect(await screen.findByText("Upload response is missing a valid job ID.")).toBeTruthy();
    expect(apiMock.mock.calls.some(([path]) => /^\/pacs\/remap\/jobs\/(?!active$)/.test(String(path)))).toBe(false);
  });

  it("normalizes a Recent Jobs string ID before selecting and requesting the job", async () => {
    const job = { id: "93", status: "processing", processing_stage: "uploading_to_orthanc", staged_file_count: 5425, processed_file_count: 4 };
    apiMock.mockImplementation((path: string) => {
      if (path === "/pacs/remap/destinations") return Promise.resolve({ destinations: [] });
      if (path === "/pacs/remap/jobs/active") return Promise.resolve({ job: null, comparison: null });
      if (path === "/pacs/remap/jobs?limit=20") return Promise.resolve({ jobs: [job] });
      if (path === "/pacs/remap/jobs/93") return Promise.resolve({ job, comparison: null });
      return Promise.resolve({ appointments: [], items: [] });
    });

    renderPage();
    fireEvent.click(screen.getByText("View recent jobs"));
    fireEvent.click(await screen.findByRole("button", { name: /#93.*Processing/i }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/pacs/remap/jobs/93"));
    expect(apiMock.mock.calls.some(([path]) => /\/pacs\/remap\/jobs\/(?:null|undefined|NaN|\[object Object\])(?:$|\/)/.test(String(path)))).toBe(false);
  });

  it("normalizes an active staged job string ID before auto-resuming it", async () => {
    const job = {
      id: "93",
      status: "awaiting_confirmation",
      processing_stage: "awaiting_confirmation",
      staged_manifest_version: 2,
      provisional_source_identity: { studyInstanceUid: "1.2.93", patientId: "SOURCE-93", patientName: "Source^NinetyThree", patientBirthDate: "19900101", patientSex: "M", modality: "CT", studyDate: "20260101" },
    };
    apiMock.mockImplementation((path: string) => {
      if (path === "/pacs/remap/destinations") return Promise.resolve({ destinations: [] });
      if (path === "/pacs/remap/jobs/active") return Promise.resolve({ job, comparison: null });
      if (path === "/pacs/remap/jobs?limit=20") return Promise.resolve({ jobs: [] });
      if (path === "/pacs/remap/jobs/93") return Promise.resolve({ job, comparison: null });
      return Promise.resolve({ appointments: [], items: [] });
    });

    renderPage();

    expect(await screen.findByText("Existing remap job #93 resumed automatically.")).toBeTruthy();
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/pacs/remap/jobs/93"));
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

  it("restores an auto-resumed staged workflow after viewing a background job", async () => {
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
    const backgroundJob = {
      id: 74,
      status: "processing",
      processing_stage: "rewriting",
      selected_study_instance_uid: "9.9.74",
      original_patient_name: "Background^Source",
      replacement_patient_name: "Background^Target",
      destination_pacs_key: "BACKGROUND",
      staged_file_count: 8,
      processed_file_count: 3,
    };
    let confirmationBody: Record<string, unknown> | null = null;
    apiMock.mockImplementation((path: string, options?: { method?: string; body?: string }) => {
      if (path === "/pacs/remap/destinations") return Promise.resolve({ destinations: [{ key: "MAIN", name: "Main PACS" }, { key: "BACKGROUND", name: "Background PACS" }] });
      if (path === "/pacs/remap/jobs/active") return Promise.resolve({ job: awaitingJob, comparison: null });
      if (path === "/pacs/remap/jobs?limit=20") return Promise.resolve({ jobs: [backgroundJob] });
      if (path === "/pacs/remap/jobs/73") return Promise.resolve({ job: awaitingJob, comparison: null });
      if (path === "/pacs/remap/jobs/74") return Promise.resolve({ job: backgroundJob, comparison: null });
      if (path === "/pacs/remap/jobs/73/confirm-staged" && options?.method === "POST") {
        confirmationBody = JSON.parse(options.body || "{}");
        return Promise.resolve({ job: { ...awaitingJob, status: "uploaded", processing_stage: "queued", rispro_patient_id: 33, destination_pacs_key: "MAIN" } });
      }
      if (String(path).startsWith("/v2/read/appointments?dateFrom=")) return Promise.resolve({ appointments: [{ id: 701, patient_id: 33, appointment_date: "2026-01-01", english_full_name: "Resumed Patient A" }] });
      if (path === "/pacs/remap/replacement-preview") return Promise.resolve({ replacement: { patientId: "TARGET-33", patientName: "Resumed^PatientA", patientSex: "F", patientBirthDate: "19900101" } });
      return Promise.resolve({ items: [] });
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderPage();
    expect(await screen.findByRole("heading", { name: "Patient" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /Resumed Patient A/ }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Continue to Destination" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Continue to Destination" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "MAIN" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue to Review" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "I confirm this is the correct study and correct RISPro patient." }));

    fireEvent.click(screen.getByText("View recent jobs"));
    fireEvent.click(await screen.findByRole("button", { name: /#74.*Processing/i }));
    expect((await screen.findByLabelText("Persisted job context")).textContent).toContain("Background^Source");
    fireEvent.click(screen.getByRole("button", { name: "Start new upload" }));

    expect(await screen.findByRole("heading", { name: "Review" })).toBeTruthy();
    const restoredSummary = screen.getByLabelText("Selection summary");
    expect(restoredSummary.textContent).toContain("1.2.73");
    expect(restoredSummary.textContent).toContain("Resumed Patient A");
    expect(restoredSummary.textContent).toContain("Main PACS");
    expect((screen.getByRole("checkbox", { name: "I confirm this is the correct study and correct RISPro patient." }) as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Confirm patient and destination; begin remap" }));
    await waitFor(() => expect(confirmationBody).toEqual({ selectedStudyInstanceUID: "1.2.73", risproPatientId: "33", destinationPacsKey: "MAIN", confirm: true }));
    expect(apiMock).toHaveBeenCalledWith("/pacs/remap/jobs/73");
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
    const job = { id: 82, status: "failed", processing_stage: "failed", source_orthanc_study_id: "source", modified_orthanc_study_id: "modified", destination_pacs_key: "1", error_message: "Original persisted failure", processing_error_code: "ORIGINAL_PROCESSING_ERROR", processing_error_details: { original: true }, orthanc_send_job_id: "orthanc-old", send_attempt_count: 3, send_error_code: "ORTHANC_SEND_JOB_FAILED", send_error_details: null, dicom_integrity_version: 1, dicom_integrity_verified_at: "2026-08-13T00:00:00.000Z" };
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

  it("locks comparison patient context and creates the upload through a comparison-linked endpoint", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/comparisons/77") return Promise.resolve({ comparisonRequest: { id: 77, patientId: 10, patientMrn: "MRN-10", patientEnglishName: "Comparison Patient", patientArabicName: null, linkedExamName: "CT Chest", linkedStudyDate: "2026-01-01", linkedPreviousAccessionNumber: "V2-000077", reason: "Compare interval change", status: "pending_upload_confirmation" } });
      if (path === "/pacs/remap/destinations?comparisonRequestId=77") return Promise.resolve({ destinations: [{ key: "1", name: "Main PACS", isDefault: true }] });
      if (path === "/pacs/remap/replacement-preview?comparisonRequestId=77") return Promise.resolve({ replacement: { patientId: "N1", patientName: "Comparison^Patient", patientSex: "F", patientBirthDate: "19900101" } });
      if (path === "/pacs/remap/jobs/88?comparisonRequestId=77") return Promise.resolve({ job: { id: 88, comparison_request_id: 77, status: "sending", destination_pacs_key: "1", processing_stage: "enqueueing_send" }, comparison: null });
      return Promise.resolve({ items: [] });
    });
    renderPage("/comparisons/77/remap?comparisonRequestId=77&patientId=999&returnPath=%2Fcomparisons%2F77");
    await screen.findByText("Comparison-linked remap");

    await scanOne();
    expect(previewMock).toHaveBeenCalledWith(expect.any(Array), { endpoint: "/api/pacs/remap/preview-multipart?comparisonRequestId=77" });
    fireEvent.click(screen.getByRole("button", { name: "Continue to Patient" }));
    expect(await screen.findByText(/Patient selection cannot be changed/)).toBeTruthy();
    await waitFor(() => expect((screen.getByRole("button", { name: "Continue to Destination" }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByPlaceholderText(/Search by patient name/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue to Destination" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue to Review" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "I confirm this is the correct study and correct RISPro patient." }));
    fireEvent.click(screen.getByRole("button", { name: /Upload selected study/ }));
    await waitFor(() => expect(FakeXHR.instances.some((xhr) => xhr.url === "/api/pacs/remap/jobs/process-multipart?comparisonRequestId=77")).toBe(true));
  });

  it("renders persisted safe Orthanc verification diagnostics without UID values", async () => {
    const job = { id: 83, status: "failed", processing_stage: "failed", error_message: "Orthanc could not verify the remapped study.", processing_error_code: "DICOM_REMAP_ORTHANC_VERIFICATION_FAILED", processing_error_details: { code: "DICOM_REMAP_ORTHANC_VERIFICATION_FAILED", verificationReason: "EXPECTED_ACTUAL_COUNT_MISMATCH", expectedCount: 399, actualCount: 398, seriesCount: 7, enumerationMethod: "series", orthancProduct: "Orthanc", orthancVersion: "1.12.11", studyResponseShape: "object(keys=ID,IsStable,Series)", instancesResponseShape: "array(length=398, first=string)" }, send_attempt_count: 0 };
    apiMock.mockImplementation((path: string) => {
      if (path === "/pacs/remap/destinations") return Promise.resolve({ destinations: [] });
      if (path === "/pacs/remap/jobs/active") return Promise.resolve({ job: null, comparison: null });
      if (path === "/pacs/remap/jobs?limit=20") return Promise.resolve({ jobs: [job] });
      if (path === "/pacs/remap/jobs/83") return Promise.resolve({ job, comparison: null });
      return Promise.resolve({ appointments: [], items: [] });
    });
    renderPage();
    fireEvent.click(screen.getByText("View recent jobs"));
    fireEvent.click(await screen.findByRole("button", { name: /#83.*Failed/i }));
    const details = await screen.findByText(/EXPECTED_ACTUAL_COUNT_MISMATCH/);
    expect(details.textContent).toContain("expectedCount");
    expect(details.textContent).toContain("399");
    expect(details.textContent).toContain("enumerationMethod");
    expect(details.textContent).not.toMatch(/StudyInstanceUID|SOPInstanceUID|PatientID/i);
  });

  it("keeps Recent Jobs secondary and requires the existing ambiguous-send confirmation", async () => {
    const job = { id: 91, status: "failed", source_orthanc_study_id: "s", modified_orthanc_study_id: "s", destination_pacs_key: "1", send_error_code: "ORTHANC_SEND_ENQUEUE_AMBIGUOUS", error_message: "RISpro could not confirm whether PACS received this study.", dicom_integrity_version: 1, dicom_integrity_verified_at: "2026-08-13T00:00:00.000Z" };
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
    expect(screen.getAllByText(/could not confirm whether PACS received/i).length).toBeGreaterThan(0);
    const resend = await waitFor(() => screen.getByRole("button", { name: "Resend to PACS" }) as HTMLButtonElement);
    expect(resend.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/I checked the destination PACS/i));
    expect(resend.disabled).toBe(false);
  });

  it("keeps a 502 process-multipart failure recoverable without requesting a null job", async () => {
    FakeXHR.nextResponse = { status: 502, body: { error: { message: "DICOM upload gateway unavailable." } } };
    renderPage();
    await scanOne();
    fireEvent.click(screen.getByRole("button", { name: "Continue to Patient" }));
    fireEvent.click(await screen.findByRole("button", { name: /John Doe/ }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Continue to Destination" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Continue to Destination" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue to Review" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "I confirm this is the correct study and correct RISPro patient." }));
    fireEvent.click(screen.getByRole("button", { name: "Upload selected study, remap, and send to PACS" }));

    expect(await screen.findByRole("heading", { name: "Review" })).toBeTruthy();
    expect(screen.getByText("DICOM upload gateway unavailable.")).toBeTruthy();
    expect(screen.getAllByText(/CT Chest/).length).toBeGreaterThan(0);
    expect(apiMock.mock.calls.some(([path]) => /\/pacs\/remap\/jobs\/(?:null|undefined|NaN|0)(?:$|\/)/.test(String(path)))).toBe(false);
    expect(screen.queryByText(/could not be refreshed temporarily/i)).toBeNull();
  });

  it.each([null, undefined, Number.NaN, 0, -1, 1.5])("does not enable the current-job query for invalid job ID %s", async (invalidJobId) => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/pacs/remap/destinations") return Promise.resolve({ destinations: [] });
      if (path === "/pacs/remap/jobs/active") return Promise.resolve({
        job: { id: invalidJobId, status: "awaiting_confirmation", processing_stage: "awaiting_confirmation", staged_manifest_version: 2 },
        comparison: null,
      });
      if (path === "/pacs/remap/jobs?limit=20") return Promise.resolve({ jobs: [] });
      return Promise.resolve({ items: [] });
    });

    renderPage();
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/pacs/remap/jobs/active"));
    expect(apiMock.mock.calls.some(([path]) => /^\/pacs\/remap\/jobs\/(?!active$)/.test(String(path)))).toBe(false);
  });

  it("shows Retry with Orthanc only for an eligible failed processing job", async () => {
    let job = { id: 92, status: "failed", processing_stage: "failed", processing_error_code: "DICOM_REMAP_PIXEL_INTEGRITY_FAILED", processing_error_details: { failedInvariant: "TransferSyntaxUID" }, orthanc_recovery_status: "available", orthanc_recovery_expires_at: new Date(Date.now() + 60_000).toISOString(), staging_cleanup_completed_at: null, destination_pacs_key: "1", modified_orthanc_study_id: null as string | null, send_error_code: null, send_attempt_count: 0, dicom_integrity_version: null as number | null, dicom_integrity_verified_at: null as string | null };
    apiMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === "/pacs/remap/destinations") return Promise.resolve({ destinations: [] });
      if (path === "/pacs/remap/jobs?limit=20") return Promise.resolve({ jobs: [job] });
      if (path === "/pacs/remap/jobs/92") return Promise.resolve({ job, comparison: null });
      if (path === "/pacs/remap/jobs/92/retry-with-orthanc" && options?.method === "POST") {
        job = { ...job, status: "sending", processing_stage: "enqueueing_send", orthanc_recovery_status: "completed", modified_orthanc_study_id: "orthanc-modified", dicom_integrity_version: 1, dicom_integrity_verified_at: "2026-08-13T00:00:00.000Z" };
        return Promise.resolve({ job });
      }
      return Promise.resolve({ job: null, comparison: null, appointments: [], items: [] });
    });
    renderPage();
    fireEvent.click(screen.getByText("View recent jobs"));
    fireEvent.click(await screen.findByRole("button", { name: /#92.*Failed/i }));
    expect(await screen.findByRole("button", { name: "Retry with Orthanc" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Resend to PACS" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry with Orthanc" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/pacs/remap/jobs/92/retry-with-orthanc", { method: "POST" }));
  });

  it("shows Re-upload required when Orthanc recovery staging has expired", async () => {
    const job = { id: 93, status: "failed", processing_stage: "failed", processing_error_code: "DICOM_REMAP_PIXEL_INTEGRITY_FAILED", orthanc_recovery_status: "available", orthanc_recovery_expires_at: "2026-01-01T00:00:00.000Z", staging_cleanup_completed_at: null, destination_pacs_key: "1", modified_orthanc_study_id: null, send_error_code: null, send_attempt_count: 0 };
    apiMock.mockImplementation((path: string) => {
      if (path === "/pacs/remap/destinations") return Promise.resolve({ destinations: [] });
      if (path === "/pacs/remap/jobs?limit=20") return Promise.resolve({ jobs: [job] });
      if (path === "/pacs/remap/jobs/93") return Promise.resolve({ job, comparison: null });
      return Promise.resolve({ job: null, comparison: null, appointments: [], items: [] });
    });
    renderPage();
    fireEvent.click(screen.getByText("View recent jobs"));
    fireEvent.click(await screen.findByRole("button", { name: /#93.*Failed/i }));
    expect((await screen.findAllByText("Re-upload required")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Retry with Orthanc" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Resend to PACS" })).toBeNull();
  });

  it.each(["remapped", "sent"])("does not expose Retry Send for a %s job", async (status) => {
    const job = { id: status === "remapped" ? 94 : 95, status, processing_stage: status === "remapped" ? "enqueueing_send" : "completed", modified_orthanc_study_id: "verified-study", destination_pacs_key: "1", send_error_code: null, dicom_integrity_version: 1, dicom_integrity_verified_at: "2026-08-13T00:00:00.000Z", send_attempt_count: 1 };
    apiMock.mockImplementation((path: string) => {
      if (path === "/pacs/remap/destinations") return Promise.resolve({ destinations: [] });
      if (path === "/pacs/remap/jobs?limit=20") return Promise.resolve({ jobs: [job] });
      if (path === `/pacs/remap/jobs/${job.id}`) return Promise.resolve({ job, comparison: null });
      return Promise.resolve({ job: null, comparison: null, appointments: [], items: [] });
    });
    renderPage();
    fireEvent.click(screen.getByText("View recent jobs"));
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(`#${job.id}.*${status}`, "i") }));
    expect(screen.queryByRole("button", { name: "Resend to PACS" })).toBeNull();
  });
});
