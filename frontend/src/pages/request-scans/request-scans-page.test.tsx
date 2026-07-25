import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const languageState = vi.hoisted(() => ({ language: "en" as "en" | "ar" }));
vi.mock("@/providers/language-provider", () => ({ useLanguage: () => ({ language: languageState.language, isArabic: languageState.language === "ar", t: (key: string) => key }) }));
vi.mock("@/providers/auth-provider", () => ({ useAuth: () => ({ user: { id: 1, role: "super_admin" } }) }));

import RequestScansPage from "./request-scans-page";

const response = (value: unknown) => ({ ok: true, json: async () => value }) as Response;
const health = { name: "archive-share", state: "unavailable", affectedCount: 31, lastConnectionCheck: "2026-07-24T10:00:00Z", lastSuccessfulArchive: "2026-07-24T09:00:00Z", nextRetryAt: "2026-07-24T10:02:00Z", lastError: "Connection unavailable" };
const status = { enabled: true, lastRunAt: "2026-07-24T10:00:00Z", lastError: null, running: false, workerOnline: true, pending: 2, processing: 1, processedToday: 2, failed: 1, canRetryArchives: true, archiveDestination: health };
type JobFixture = { id: number; filename: string; status: string; barcode_value: string | null; appointment_id: number | null; document_id: number | null; attachment_completed_at: string | null; source_moved_at: string | null; archive_attempt_count: number; last_archive_attempt_at: string | null; archive_last_error: string | null; error_message: string | null; attempt_count: number; created_at: string; patient_name: string | null; patient_name_ar?: string | null; patient_name_en?: string | null; patient_mrn: string | null; patient_date_of_birth: string | null; modality_name: string | null; modality_name_ar?: string | null; modality_name_en?: string | null; exam_name: string | null; exam_name_ar?: string | null; exam_name_en?: string | null; failure_category?: string | null; processing_stage?: string | null; appointment_date?: string | null };
const archiveFailure: JobFixture = { id: 9, filename: "request.pdf", status: "failed", barcode_value: "V2-000009", appointment_id: 9, document_id: 55, attachment_completed_at: "2026-07-24T09:30:00Z", source_moved_at: null, archive_attempt_count: 7, last_archive_attempt_at: "2026-07-24T10:00:00Z", archive_last_error: "Connection unavailable", error_message: "Connection unavailable", attempt_count: 7, created_at: "2026-07-24T09:00:00Z", patient_name: "Patient One", patient_name_ar: "المريض الأول", patient_name_en: "Patient One", patient_mrn: "MRN-9", patient_date_of_birth: "1980-01-01", modality_name: "CT", modality_name_ar: "التصوير المقطعي", modality_name_en: "CT", exam_name: "Head", exam_name_ar: "الرأس", exam_name_en: "Head", failure_category: "smb_storage", processing_stage: "archive", appointment_date: "2026-07-25" };
const completed = { ...archiveFailure, id: 10, filename: "completed.pdf", status: "processed", source_moved_at: "2026-07-24T10:01:00Z", archive_last_error: null };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/request-scans"]}><Routes><Route path="/request-scans" element={<RequestScansPage />} /><Route path="/registrations" element={<div>Registration destination</div>} /></Routes></MemoryRouter></QueryClientProvider>);
}

function mock(jobs = [archiveFailure]) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const value = String(input);
    if (value.endsWith("/status")) return response(status);
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
    if (value.includes("/api/request-scans/") && value.endsWith("/file")) return { ok: true, blob: async () => new Blob(["%PDF-1.4"], { type: "application/pdf" }) } as Response;
    if (value.includes("eligible-appointments")) return response({ appointments: [{ id: 12, accession_number: "V2-000012", patient_name: "Selected Patient", patient_name_ar: "المريض المحدد", patient_name_en: "Selected Patient", patient_mrn: "MRN-12", patient_date_of_birth: "1981-01-01", modality_name: "MRI", modality_name_ar: "الرنين", modality_name_en: "MRI", exam_name: "Brain", exam_name_ar: "الدماغ", exam_name_en: "Brain", appointment_date: "2026-07-25" }] });
    if (value.includes("?status=")) return response({ jobs });
    return response({ jobs: [] });
  });
}

async function openMenu(filename = "request.pdf") {
  fireEvent.click(await screen.findByRole("button", { name: `More actions for ${filename}` }));
  return screen.getByRole("menu", { name: `Actions for ${filename}` });
}

afterEach(() => { languageState.language = "en"; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("RequestScansPage", () => {
  it("renders a compact operational header and localized English table", async () => {
    mock();
    renderPage();
    expect(await screen.findByRole("heading", { name: "Request Scans" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: /Processing 1/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Queued 2/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Processed today 2/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Needs attention 1/ })).toBeTruthy();
    expect(screen.queryByText("Workload")).toBeNull();
    expect(screen.getByText("Matched")).toBeTruthy();
    expect(screen.getByText("Attached")).toBeTruthy();
    expect(screen.getByText("Archived")).toBeTruthy();
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
    expect(items).toHaveLength(5);
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
    mock([{ ...completed, appointment_id: "9" as unknown as number }]);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Open appointment" }));

    expect(await screen.findByText("Patient One")).toBeTruthy();
    expect(screen.getAllByText("V2-000009").length).toBeGreaterThan(0);
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
    expect(await screen.findByText("Selected Patient")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /I verified the patient identity/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm and queue attachment" }));
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
