import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const languageState = vi.hoisted(() => ({ language: "en" as "en" | "ar" }));
const authState = vi.hoisted(() => ({ role: "super_admin" as string }));
vi.mock("@/providers/language-provider", () => ({ useLanguage: () => ({ language: languageState.language, isArabic: languageState.language === "ar", t: (key: string) => key }) }));
vi.mock("@/providers/auth-provider", () => ({ useAuth: () => ({ user: { id: 1, role: authState.role } }) }));

import RequestScansPage, { sanitizeClinicalDocumentExportError } from "./request-scans-page";

const response = (value: unknown) => ({ ok: true, json: async () => value }) as Response;
const health = { name: "archive-share", state: "unavailable", affectedCount: 31, lastConnectionCheck: "2026-07-24T10:00:00Z", lastSuccessfulArchive: "2026-07-24T09:00:00Z", nextRetryAt: "2026-07-24T10:02:00Z", lastError: "Connection unavailable" };
const status = { enabled: true, lastRunAt: "2026-07-24T10:00:00Z", lastError: null, running: false, workerOnline: true, pending: 2, processing: 1, processedToday: 2, failed: 1, canRetryArchives: true, archiveDestination: health };
type JobFixture = { id: number; filename: string; status: string; barcode_value: string | null; appointment_id: number | null; document_id: number | null; attachment_completed_at: string | null; source_moved_at: string | null; archive_attempt_count: number; last_archive_attempt_at: string | null; archive_last_error: string | null; error_message: string | null; attempt_count: number; created_at: string; patient_name: string | null; patient_name_ar?: string | null; patient_name_en?: string | null; patient_mrn: string | null; patient_date_of_birth: string | null; modality_name: string | null; modality_name_ar?: string | null; modality_name_en?: string | null; exam_name: string | null; exam_name_ar?: string | null; exam_name_en?: string | null; failure_category?: string | null; processing_stage?: string | null; appointment_date?: string | null; appointment_status?: string | null; clinical_document_export_status?: "pending" | "exporting" | "exported" | "failed" | "blocked" | null; clinical_document_export_id?: number | null; clinical_document_export_representation_type?: "secondary_capture"; clinical_document_export_expected_page_count?: number | null; clinical_document_export_exported_page_count?: number | null; clinical_document_export_verified_page_count?: number | null; clinical_document_export_failed_page_number?: number | null; clinical_document_export_last_attempt_at?: string | null; clinical_document_export_next_retry_at?: string | null; clinical_document_exported_at?: string | null; clinical_document_export_last_error?: string | null };
const archiveFailure: JobFixture = { id: 9, filename: "request.pdf", status: "failed", barcode_value: "V2-000009", appointment_id: 9, document_id: 55, attachment_completed_at: "2026-07-24T09:30:00Z", source_moved_at: null, archive_attempt_count: 7, last_archive_attempt_at: "2026-07-24T10:00:00Z", archive_last_error: "Connection unavailable", error_message: "Connection unavailable", attempt_count: 7, created_at: "2026-07-24T09:00:00Z", patient_name: "Patient One", patient_name_ar: "المريض الأول", patient_name_en: "Patient One", patient_mrn: "MRN-9", patient_date_of_birth: "1980-01-01", modality_name: "CT", modality_name_ar: "التصوير المقطعي", modality_name_en: "CT", exam_name: "Head", exam_name_ar: "الرأس", exam_name_en: "Head", failure_category: "smb_storage", processing_stage: "archive", appointment_date: "2026-07-25" };
const completed = { ...archiveFailure, id: 10, filename: "completed.pdf", status: "processed", source_moved_at: "2026-07-24T10:01:00Z", archive_last_error: null };
const pending = { ...archiveFailure, id: 20, filename: "queued.pdf", status: "pending", barcode_value: null, appointment_id: null, document_id: null, attachment_completed_at: null, source_moved_at: null, processing_stage: "queued" };
const processing = { ...pending, id: 21, filename: "processing.pdf", status: "processing", processing_stage: "recognition" };
const unassignedFailure = { ...pending, id: 22, filename: "V2-003838.pdf", status: "failed", failure_category: "recognition" };

function renderPage(modality?: { id: number; code: string; name: string; onBack: () => void }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/request-scans"]}><Routes><Route path="/request-scans" element={<RequestScansPage modality={modality} />} /><Route path="/registrations" element={<div>Registration destination</div>} /></Routes></MemoryRouter></QueryClientProvider>);
}

function mock(jobs = [archiveFailure]) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const value = String(input);
    if (value.includes("/api/request-scans/status")) return response(status);
    if (value.includes("/v2/lookups/special-reason-codes")) return response({ items: [] });
    if (value.includes("/api/v2/read/appointments/")) return response({ appointment: {
      id: 9,
      patient_id: 1,
      accession_number: "V2-000009",
      patient_name: "Patient One",
      patient_name_ar: "المريض الأول",
      patient_name_en: "Patient One",
      patient_mrn: "MRN-9",
      modality_name_ar: "التصوير المقطعي",
      modality_name_en: "CT",
      modality_code: "CT",
      exam_name_ar: "الرأس",
      exam_name_en: "Head",
      modality_id: 1,
      exam_type_id: 3,
      appointment_date: "2026-07-25",
      status: "scheduled",
      created_at: "2026-07-24T09:00:00Z",
      public_appointment_url: "https://rispro.test/public/appointment?t=scan-token",
    } });
    if (/\/api\/request-scans\/\d+\/file(?:\?|$)/.test(value)) return { ok: true, blob: async () => new Blob(["%PDF-1.4"], { type: "application/pdf" }) } as Response;
    if (value.includes("eligible-appointments")) return response({ appointments: [{ id: 12, accession_number: "V2-000012", patient_name: "Selected Patient", patient_name_ar: "المريض المحدد", patient_name_en: "Selected Patient", patient_mrn: "MRN-12", patient_date_of_birth: "1981-01-01", modality_name: "MRI", modality_name_ar: "الرنين", modality_name_en: "MRI", exam_name: "Brain", exam_name_ar: "الدماغ", exam_name_en: "Brain", appointment_date: "2026-07-25" }] });
    if (value.includes("?status=")) return response({ jobs });
    return response({ jobs: [] });
  });
}

async function openMenu(filename = "request.pdf") {
  fireEvent.click(await screen.findByRole("button", { name: `More actions for ${filename}` }));
  return screen.getByRole("menu", { name: `Actions for ${filename}` });
}

afterEach(() => { languageState.language = "en"; authState.role = "super_admin"; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("RequestScansPage", () => {
  it("shows the scoped Start now action for a queued job", async () => {
    const fetchMock = mock([pending]);
    renderPage({ id: 7, code: "CT", name: "CT", onBack: vi.fn() });
    fireEvent.click(await screen.findByRole("button", { name: "Start now" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/request-scans/20/start-now?workflowSource=modality&modalityId=7")).toBe(true));
    expect(screen.getAllByText("Queued").length).toBeGreaterThan(1);
  });

  it("shows Stop & review before attachment and reports Stopping while cancellation is pending", async () => {
    const fetchMock = mock([processing]);
    renderPage({ id: 7, code: "CT", name: "CT", onBack: vi.fn() });
    fireEvent.click(await screen.findByRole("button", { name: "Stop & review" }));
    expect((screen.getByRole("button", { name: "Stopping…" }) as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/request-scans/21/stop?workflowSource=modality&modalityId=7")).toBe(true));
  });

  it("keeps the failed-unassigned assignment action and automatic retry in More actions", async () => {
    mock([unassignedFailure]);
    renderPage();
    expect(await screen.findByRole("button", { name: "Assign appointment" })).toBeTruthy();
    const menu = await openMenu("V2-003838.pdf");
    expect(within(menu).getByRole("menuitem", { name: "Retry automatic recognition" })).toBeTruthy();
  });

  it("prefills one filename accession without selecting an appointment", async () => {
    mock([unassignedFailure]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Assign appointment" }));
    const search = await screen.findByLabelText("Selected RIS appointment");
    expect((search as HTMLInputElement).value).toBe("V2-003838");
    expect(screen.getByText("Filename suggestion — not verified")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Confirm patient and attach" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("uses contextual modality folder wording while keeping the global scan action", async () => {
    mock([]);
    renderPage({ id: 7, code: "MR", name: "MR", onBack: vi.fn() });
    expect(await screen.findByRole("button", { name: "Scan MR folder now" })).toBeTruthy();
    expect(screen.getByText(/Discovers files and starts a worker cycle/)).toBeTruthy();
  });

  it("shows and authorizes the dismissed tab and restore action", async () => {
    const dismissed = { ...unassignedFailure, dismissed_at: "2026-07-27T10:00:00Z" };
    const fetchMock = mock([dismissed]);
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: /Dismissed/ }));
    expect(await screen.findByText("V2-003838.pdf")).toBeTruthy();
    const menu = await openMenu("V2-003838.pdf");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Restore" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/22/restore-dismissed"))).toBe(true));
    cleanup();
    authState.role = "modality_staff";
    mock([unassignedFailure]);
    renderPage();
    expect(screen.queryByRole("tab", { name: /Dismissed/ })).toBeNull();
  });

  it("shows supervisor Retry matching for blocked clinical exports and queues the retry", async () => {
    const fetchMock = mock([{ ...archiveFailure, status: "processed", source_moved_at: "2026-07-24T10:01:00Z", clinical_document_export_status: "blocked", clinical_document_export_id: 101, appointment_status: "completed", clinical_document_export_last_error: "Patient identity conflict" }]);
    renderPage({ id: 7, code: "CT", name: "CT", onBack: vi.fn() });
    fireEvent.click(await screen.findByRole("button", { name: "Retry matching" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/api/integrations/authoritative-orthanc/document-exports/101/retry"))).toBe(true));
  });

  it("uses the Arabic blocked-export retry-matching label", async () => {
    languageState.language = "ar";
    mock([{ ...archiveFailure, status: "processed", source_moved_at: "2026-07-24T10:01:00Z", clinical_document_export_status: "blocked", clinical_document_export_id: 101, appointment_status: "completed" }]);
    renderPage({ id: 7, code: "CT", name: "CT", onBack: vi.fn() });
    expect(await screen.findByRole("button", { name: "إعادة المطابقة" })).toBeTruthy();
  });

  it("does not show blocked-export retry matching to modality staff", async () => {
    authState.role = "modality_staff";
    mock([{ ...archiveFailure, status: "processed", source_moved_at: "2026-07-24T10:01:00Z", clinical_document_export_status: "blocked", clinical_document_export_id: 101, appointment_status: "completed" }]);
    renderPage({ id: 7, code: "CT", name: "CT", onBack: vi.fn() });
    await screen.findByText("request.pdf");
    expect(screen.queryByRole("button", { name: "Retry matching" })).toBeNull();
  });

  it("keeps ordinary failed clinical exports on the Retry wording and hides retry for exported exports", async () => {
    mock([{ ...archiveFailure, status: "processed", source_moved_at: "2026-07-24T10:01:00Z", clinical_document_export_status: "failed", clinical_document_export_id: 101, appointment_status: "completed" }, { ...completed, id: 11, filename: "exported.pdf", clinical_document_export_status: "exported", clinical_document_export_id: 102, appointment_status: "completed" }]);
    renderPage({ id: 7, code: "CT", name: "CT", onBack: vi.fn() });
    expect(await screen.findByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry matching" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
  });

  it("shows waiting, pending, exporting progress, and verified page progress without missing-count artifacts", async () => {
    mock([
      { ...completed, id: 31, filename: "waiting.pdf", appointment_status: "scheduled", clinical_document_export_status: null },
      { ...completed, id: 32, filename: "pending.pdf", appointment_status: "completed", clinical_document_export_status: "pending" },
      { ...completed, id: 33, filename: "exporting.pdf", appointment_status: "completed", clinical_document_export_status: "exporting", clinical_document_export_expected_page_count: 2, clinical_document_export_verified_page_count: 1 },
      { ...completed, id: 34, filename: "exported.pdf", appointment_status: "completed", clinical_document_export_status: "exported", clinical_document_export_expected_page_count: 2, clinical_document_export_exported_page_count: 2, clinical_document_export_verified_page_count: 2 },
    ]);
    renderPage({ id: 7, code: "CT", name: "CT", onBack: vi.fn() });
    expect(await screen.findByText("Waiting for study completion")).toBeTruthy();
    expect(screen.getByText("Pending export")).toBeTruthy();
    expect(screen.getByText("Exporting")).toBeTruthy();
    expect(screen.getByText("Exported to PACS")).toBeTruthy();
    expect(screen.getAllByText(/1\/2 pages verified|2\/2 pages verified/)).toHaveLength(2);
    expect(screen.queryByText(/undefined|NaN/)).toBeNull();
  });

  it("shows sanitized export details, retry timing, and a failed page in the existing details dialog", async () => {
    mock([{ ...completed, filename: "export-details.pdf", appointment_status: "completed", clinical_document_export_status: "failed", clinical_document_export_id: 121, clinical_document_export_representation_type: "secondary_capture", clinical_document_export_expected_page_count: 2, clinical_document_export_exported_page_count: 1, clinical_document_export_verified_page_count: 1, clinical_document_export_failed_page_number: 2, clinical_document_export_last_attempt_at: "2026-07-28T10:00:00Z", clinical_document_export_next_retry_at: "2026-07-28T10:15:00Z", clinical_document_exported_at: "2026-07-28T09:59:00Z", clinical_document_export_last_error: "Failed to open C:\\Patient Documents\\John Doe.pdf Authorization: Bearer secret" }]);
    renderPage({ id: 7, code: "CT", name: "CT", onBack: vi.fn() });
    expect(await screen.findByText("Failed on page 2")).toBeTruthy();
    const menu = await openMenu("export-details.pdf");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "View processing details" }));
    expect(await screen.findByRole("region", { name: "Clinical document export details" })).toBeTruthy();
    expect(screen.getByText("Secondary Capture")).toBeTruthy();
    expect(screen.getByText("1/2 exported; 1/2 verified")).toBeTruthy();
    expect(screen.queryByText(/John Doe|Doe\.pdf|secret|C:\\Patient/i)).toBeNull();
    expect(screen.getByText(/\[redacted\]|local path/i)).toBeTruthy();
  });

  it("shows a failed page only for failed or blocked exports, not stale retry state", async () => {
    mock([
      { ...completed, id: 41, filename: "failed-page.pdf", appointment_status: "completed", clinical_document_export_status: "failed", clinical_document_export_failed_page_number: 2, clinical_document_export_expected_page_count: 2, clinical_document_export_verified_page_count: 1 },
      { ...completed, id: 42, filename: "blocked-page.pdf", appointment_status: "completed", clinical_document_export_status: "blocked", clinical_document_export_failed_page_number: 2, clinical_document_export_expected_page_count: 2, clinical_document_export_verified_page_count: 1 },
      { ...completed, id: 43, filename: "pending-page.pdf", appointment_status: "completed", clinical_document_export_status: "pending", clinical_document_export_failed_page_number: 2, clinical_document_export_expected_page_count: 2, clinical_document_export_verified_page_count: 1 },
      { ...completed, id: 44, filename: "exporting-page.pdf", appointment_status: "completed", clinical_document_export_status: "exporting", clinical_document_export_failed_page_number: 2, clinical_document_export_expected_page_count: 2, clinical_document_export_verified_page_count: 1 },
      { ...completed, id: 45, filename: "exported-page.pdf", appointment_status: "completed", clinical_document_export_status: "exported", clinical_document_export_failed_page_number: 2, clinical_document_export_expected_page_count: 2, clinical_document_export_verified_page_count: 2 },
    ]);
    renderPage({ id: 7, code: "CT", name: "CT", onBack: vi.fn() });
    expect(await screen.findAllByText("Failed on page 2")).toHaveLength(2);
    expect(screen.getAllByText("1/2 pages verified")).toHaveLength(2);
    expect(screen.getByText("2/2 pages verified")).toBeTruthy();
  });

  it("redacts unsafe export details as a client-side defense in depth", () => {
    const unsafeValues = [
      String.raw`C:\Patient Documents\John Doe.pdf`,
      String.raw`\\server\Clinical Documents\John Doe.pdf`,
      "/usr/local/rispro/John Doe.pdf",
      "/root/scans/patient.pdf",
    ];
    for (const unsafeValue of unsafeValues) {
      const value = sanitizeClinicalDocumentExportError(`Renderer failed for ${unsafeValue} after timeout.`);
      expect(value).not.toMatch(/John Doe|Doe\.pdf|Patient Documents|C:\\Patient|\\\\server|\/usr\/local|\/root\/scans/i);
      expect(value).toMatch(/Renderer failed/);
      expect(value).toMatch(/after timeout/);
    }

    const credentials = sanitizeClinicalDocumentExportError("Authorization: Bearer secret\nCookie: sid=secret\nX-API-Key: secret\nhttps://user:password@host/path?token=secret");
    expect(credentials).not.toMatch(/secret|user:password/i);
  });

  it("scopes modality jobs, status, preview, and browser links to the selected modality", async () => {
    const fetchMock = mock();
    renderPage({ id: 7, code: "CT", name: "CT", onBack: vi.fn() });
    await screen.findByText("request.pdf");
    const calls = fetchMock.mock.calls.map(([input]) => String(input));
    expect(calls.some((value) => value.includes("/status?workflowSource=modality&modalityId=7"))).toBe(true);
    expect(calls.some((value) => value.includes("?status=active&workflowSource=modality&modalityId=7"))).toBe(true);
    const menu = await openMenu();
    expect(within(menu).getByRole("menuitem", { name: "Open in browser" }).getAttribute("href")).toBe("/api/request-scans/9/file?workflowSource=modality&modalityId=7");
  });
  it("renders a compact operational header and localized English table", async () => {
    mock();
    renderPage();
    expect(await screen.findByRole("heading", { name: "Request Scans" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: /Processing 1/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Queued 2/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Processed today 2/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Needs attention 1/ })).toBeTruthy();
    expect(screen.queryByText("Workload")).toBeNull();
    expect(screen.getByText("Match confirmed")).toBeTruthy();
    expect(screen.getByText("Attached")).toBeTruthy();
    expect(screen.getByText("Archive needs review")).toBeTruthy();
  });

  it("renders bilingual patient, modality, and examination values while keeping technical values LTR", async () => {
    mock();
    renderPage();
    expect(await screen.findByText("Patient One")).toBeTruthy();
    expect(screen.getByText(/CT/)).toBeTruthy();
    expect(screen.getByText(/التصوير المقطعي/)).toBeTruthy();
    expect(screen.getByText(/Head/)).toBeTruthy();
    expect(screen.getByText(/الرأس/)).toBeTruthy();
    expect(screen.getByText("MRN-9").getAttribute("dir")).toBe("ltr");
    expect(screen.getByText("request.pdf").getAttribute("dir")).toBe("ltr");
  });

  it("renders Arabic UI and RTL page direction", async () => {
    languageState.language = "ar";
    mock();
    renderPage();
    const root = screen.getByTestId("request-scans-page");
    expect(root.getAttribute("dir")).toBe("rtl");
    expect(await screen.findByRole("heading", { name: "مسح الطلبات" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: /request\.pdf/ })).toBeTruthy();
    expect(screen.getByText("المريض الأول")).toBeTruthy();
    expect(screen.getByText("التعرف")).toBeTruthy();
    expect(screen.getByRole("button", { name: "إجراءات إضافية لـ request.pdf" })).toBeTruthy();
  });

  it("shows archive incident details only after the details action", async () => {
    mock();
    renderPage();
    expect(await screen.findByText("Archive destination needs attention")).toBeTruthy();
    expect(screen.queryByText("archive-share")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Archive details" }));
    expect(await screen.findByText("archive-share")).toBeTruthy();
    expect(screen.getAllByText("Connection unavailable").length).toBeGreaterThan(0);
  });

  it("renders an accessible More actions menu with interactive rows", async () => {
    mock();
    renderPage();
    await screen.findByText("request.pdf");
    const menu = await openMenu();
    const items = within(menu).getAllByRole("menuitem");
    expect(items.length).toBeGreaterThanOrEqual(5);
    expect(items.every((item) => item.tagName === "BUTTON" || item.tagName === "A")).toBe(true);
    expect(within(menu).getByRole("menuitem", { name: "Preview scanned document" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "Open in browser" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "View attached document" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "Open appointment" })).toBeTruthy();
    expect(within(menu).getByRole("menuitem", { name: "View processing details" })).toBeTruthy();
  });

  it("opens request scans in the browser and retains the attached-document link", async () => {
    mock();
    renderPage();
    const menu = await openMenu();
    const browserLink = within(menu).getByRole("menuitem", { name: "Open in browser" });
    expect(browserLink.getAttribute("href")).toBe("/api/request-scans/9/file");
    expect(browserLink.getAttribute("target")).toBe("_blank");
    expect(browserLink.getAttribute("rel")).toBe("noreferrer");
    expect(within(menu).getByRole("menuitem", { name: "View attached document" }).getAttribute("href")).toBe("/api/documents/55/view");
    fireEvent.click(browserLink);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens the appointment modal from the action menu without navigating", async () => {
    mock([completed]);
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "Processed" }));
    const menu = await openMenu("completed.pdf");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Open appointment" }));
    expect(await screen.findByRole("dialog", { name: "registrations.manage" })).toBeTruthy();
    expect(screen.queryByText("Registration destination")).toBeNull();
    expect(screen.getByTestId("request-scans-page")).toBeTruthy();
    expect(screen.getByText("completed.pdf")).toBeTruthy();
    expect(screen.getByText("Patient One")).toBeTruthy();
  });

  it("opens the same appointment modal from the primary row action and preserves the selected tab", async () => {
    mock([completed]);
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "Processed" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open appointment" }));
    expect(await screen.findByRole("dialog", { name: "registrations.manage" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Processed" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "toast.close" }));
    expect(screen.queryByRole("dialog", { name: "registrations.manage" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Processed" }).getAttribute("aria-selected")).toBe("true");
  });

  it("loads the appointment when Request Scans returns the ID as a numeric string", async () => {
    const fetchMock = mock([{ ...completed, appointment_id: "9" as unknown as number }]);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Open appointment" }));

    expect(await screen.findByText("Patient One")).toBeTruthy();
    expect(screen.getAllByText("V2-000009").length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/v2/read/appointments/9")).toBe(true);
  });

  it("shows a localized notice and does not open the modal for an invalid appointment reference", async () => {
    const fetchMock = mock([{ ...completed, appointment_id: "V2-000009" as unknown as number }]);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Open appointment" }));

    expect(await screen.findByText("The appointment could not be opened because its reference is invalid.")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "registrations.manage" })).toBeNull();
    expect(screen.getByTestId("request-scans-page")).toBeTruthy();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/v2/read/appointments/"))).toBe(false);
  });

  it("opens processing details with diagnostic content", async () => {
    mock();
    renderPage();
    const menu = await openMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "View processing details" }));
    expect(await screen.findByRole("heading", { name: "Processing details" })).toBeTruthy();
    expect(screen.getByText("archive")).toBeTruthy();
    expect(screen.getByText("smb_storage")).toBeTruthy();
    expect(screen.getAllByText("Connection unavailable").length).toBeGreaterThan(0);
  });

  it("uses a large authenticated Blob preview and revokes it on close", async () => {
    const createObjectURL = vi.fn(() => "blob:request-scan-9");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const fetchMock = mock();
    renderPage();
    const menu = await openMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Preview scanned document" }));
    const iframe = await screen.findByTitle("Request scan preview");
    const fileCall = fetchMock.mock.calls.find(([input]) => String(input).includes("/api/request-scans/9/file"));
    expect(fileCall?.[0]).toBe("/api/request-scans/9/file");
    expect(fileCall?.[1]).toMatchObject({ credentials: "include" });
    expect(iframe.getAttribute("src")).toBe("blob:request-scan-9");
    const content = iframe.parentElement?.parentElement;
    expect(content?.style.maxWidth).toBe("min(96vw, 1500px)");
    expect(content?.className).toContain("h-[94vh]");
    expect(screen.getByRole("link", { name: "Open in browser" }).getAttribute("href")).toBe("/api/request-scans/9/file");
    expect(screen.getByRole("link", { name: "View attached document" }).getAttribute("href")).toBe("/api/documents/55/view");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:request-scan-9");
  });

  it("revokes the previous Blob URL when a preview is replaced", async () => {
    const createObjectURL = vi.fn().mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    mock([archiveFailure, completed]);
    renderPage();
    const firstMenu = await openMenu();
    fireEvent.click(within(firstMenu).getByRole("menuitem", { name: "Preview scanned document" }));
    await screen.findByTitle("Request scan preview");
    const secondMenu = await openMenu("completed.pdf");
    fireEvent.click(within(secondMenu).getByRole("menuitem", { name: "Preview scanned document" }));
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(2));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:first");
  });

  it("keeps archive retry and bulk retry behavior available", async () => {
    const fetchMock = mock();
    renderPage();
    expect(await screen.findByRole("button", { name: "Retry archive" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry archive" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/9/retry-archive"))).toBe(true));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select request.pdf" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry selected archives" }));
    expect(await screen.findByText(/already attached documents will not be duplicated/)).toBeTruthy();
  });

  it("keeps manual assignment and patient-identity confirmation behavior", async () => {
    const fetchMock = mock([{ ...archiveFailure, document_id: null, attachment_completed_at: null, appointment_id: null }]);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Assign appointment" }));
    expect(await screen.findByText("Detected/scanned information")).toBeTruthy();
    expect(screen.getByText("Selected RIS appointment")).toBeTruthy();
    const comboboxes = screen.getAllByRole("combobox");
    expect(await screen.findByRole("option", { name: /V2-000012/ })).toBeTruthy();
    fireEvent.change(comboboxes[1], { target: { value: "12" } });
    expect((await screen.findAllByText("Selected Patient")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("checkbox", { name: /I verified the patient identity/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm patient and attach" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/9/manual-assign"))).toBe(true));
  });

  it("does not offer archive retry controls for completed records", async () => {
    mock([completed]);
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "Processed" }));
    expect(await screen.findByText("completed.pdf")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry archive" })).toBeNull();
  });

  it("keeps loading and empty states distinct", async () => {
    mock([]);
    renderPage();
    expect(await screen.findByText("No active request scans. New scans and retries will appear here automatically.")).toBeTruthy();
  });
});
