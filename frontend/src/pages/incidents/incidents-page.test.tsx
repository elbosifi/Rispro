import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/providers/auth-provider";
import { LanguageProvider } from "@/providers/language-provider-component";
import IncidentsPage from "./incidents-page";

const { api, searchPatients, printIncidentReport } = vi.hoisted(() => ({
  api: { createIncident: vi.fn(), fetchIncident: vi.fn(), fetchIncidentEquipment: vi.fn(), fetchIncidents: vi.fn(), listIncidentAttachments: vi.fn(), reviewIncident: vi.fn(), uploadIncidentAttachment: vi.fn() },
  searchPatients: vi.fn(), printIncidentReport: vi.fn(),
}));
vi.mock("@/lib/api/incidents", async () => ({ ...(await vi.importActual<typeof import("@/lib/api/incidents")>("@/lib/api/incidents")), ...api }));
vi.mock("@/lib/api/patients", () => ({ searchPatients: (...args: unknown[]) => searchPatients(...args) }));
vi.mock("@/lib/incident-printing", () => ({ printIncidentReport: (...args: unknown[]) => printIncidentReport(...args) }));

const equipmentIncident = { id: 7, incidentNumber: "INC-000007", incident_type: "equipment" as const, status: "submitted" as const, occurred_at: "2026-08-26T21:30:00.000Z", created_at: "2026-08-26T22:00:00.000Z", description: "Long equipment description", immediate_action: "Stopped scanner", review_notes: null, reporter_name: "Reporter One", equipment_name: "MRI Scanner A", equipment_type: "MRI", location: "Room A", equipment_condition: "operational", vendor_contacted: true, vendor_contact_person: "Vendor", vendor_reference: "T-1", patient_arabic_name: null, patient_english_name: null, mrn: null, clinical_category: null, harm_level: null };
const clinicalIncident = { ...equipmentIncident, id: 8, incidentNumber: "INC-000008", incident_type: "clinical_workflow" as const, equipment_name: null, equipment_type: null, location: null, patient_arabic_name: "مريض عربي", patient_english_name: "English Patient", mrn: "MRN-8", clinical_category: "wrong_exam" as const, harm_level: "no_harm" };
const patient = { id: 22, arabicFullName: "مريض عربي", englishFullName: "English Patient", mrn: "MRN-22" };
function renderPage(role = "supervisor", language = "en") {
  localStorage.setItem("rispro-language", language);
  return render(<LanguageProvider><AuthContext.Provider value={{ user: { id: 1, username: role, fullName: role, role: role as never }, isLoading: false, login: vi.fn(), loginWithPasskey: vi.fn(), logout: vi.fn(), reAuth: vi.fn(), reAuthWithPasskey: vi.fn(), changePassword: vi.fn() }}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><IncidentsPage /></QueryClientProvider></AuthContext.Provider></LanguageProvider>);
}
async function openCreate() { await userEvent.click(await screen.findByRole("button", { name: "New Incident" })); }
async function chooseClinical() { await userEvent.click(screen.getByRole("radio", { name: "Clinical / Workflow Incident" })); }

describe("IncidentsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.fetchIncidents.mockResolvedValue({ incidents: [equipmentIncident, clinicalIncident] });
    api.fetchIncidentEquipment.mockResolvedValue({ equipment: [{ id: 1, name: "MRI Scanner A", equipment_type: "MRI", location: "Room A" }] });
    api.fetchIncident.mockResolvedValue({ incident: equipmentIncident });
    api.listIncidentAttachments.mockResolvedValue({ documents: [{ id: 1, original_filename: "proof.pdf", mime_type: "application/pdf", document_type: "incident_attachment", created_at: "2026-08-26" }] });
    api.createIncident.mockResolvedValue({ incident: equipmentIncident });
    api.reviewIncident.mockResolvedValue({ incident: equipmentIncident });
    api.uploadIncidentAttachment.mockResolvedValue({ document: {} });
    searchPatients.mockResolvedValue([patient]);
  });

  it("renders the professional register row, badges, filters, and LTR identifiers", async () => {
    const user = userEvent.setup(); renderPage();
    expect(await screen.findByText("INC-000007")).toHaveProperty("dir", "ltr");
    expect(screen.getByText("MRI Scanner A")).toHaveProperty("dir", "ltr");
    expect(screen.getAllByText("Long equipment description").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Reporter: Reporter One/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Clinical / Workflow").length).toBeGreaterThan(0);
    await user.selectOptions(screen.getByLabelText("Incident type"), "equipment");
    await waitFor(() => expect(api.fetchIncidents).toHaveBeenLastCalledWith({ incidentType: "equipment", status: "" }));
    await user.selectOptions(screen.getByLabelText("Status"), "resolved");
    await waitFor(() => expect(api.fetchIncidents).toHaveBeenLastCalledWith({ incidentType: "equipment", status: "resolved" }));
    expect(screen.getByRole("button", { name: "Reset filters" })).toBeTruthy();
  });

  it("shows loading, error with retry, and empty register states", async () => {
    api.fetchIncidents.mockImplementationOnce(() => new Promise(() => {}));
    const loading = renderPage(); expect(await screen.findByText("Loading the incident register…")).toBeTruthy(); loading.unmount();
    api.fetchIncidents.mockRejectedValueOnce(new Error("down"));
    const failed = renderPage(); expect(await screen.findByText("Unable to load the incident register.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Retry" })); failed.unmount();
    api.fetchIncidents.mockResolvedValueOnce({ incidents: [] });
    renderPage(); expect(await screen.findByText("No incidents match the selected filters.")).toBeTruthy();
  });

  it("rejects an empty or invalid datetime without calling createIncident", async () => {
    renderPage(); await openCreate();
    const input = screen.getByLabelText(/Date and time of incident/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByText("Enter a valid date and time of incident.")).toBeTruthy();
    expect(api.createIncident).not.toHaveBeenCalled();
  });

  it("submits a valid browser-local datetime with labelled equipment and vendor fields", async () => {
    const user = userEvent.setup(); renderPage(); await openCreate();
    await user.selectOptions(screen.getByLabelText(/Equipment name/), "1");
    await user.click(screen.getByRole("radio", { name: "Operational" }));
    expect(screen.getByTestId("selected-equipment-summary").textContent).toContain("Room A");
    await user.click(screen.getByRole("radio", { name: "Yes" }));
    await user.type(screen.getByLabelText("Contact person"), "Vendor");
    await user.type(screen.getByLabelText("Service reference / ticket"), "TICKET-9");
    fireEvent.change(screen.getByLabelText(/Date and time of incident/), { target: { value: "2026-08-26T23:30" } });
    await user.type(screen.getByLabelText(/Description of incident/), "Equipment issue");
    await user.click(screen.getByRole("button", { name: "Submit incident" }));
    await waitFor(() => expect(api.createIncident).toHaveBeenCalled());
    expect(api.createIncident.mock.calls[0][0]).toMatchObject({ occurredAt: new Date("2026-08-26T23:30").toISOString(), vendorContacted: true, vendorContactPerson: "Vendor", vendorReference: "TICKET-9" });
    expect((await screen.findAllByText("INC-000007")).length).toBeGreaterThan(0);
  });

  it("switches type, searches after debounce, selects and clears a patient", async () => {
    const user = userEvent.setup(); renderPage(); await openCreate(); await chooseClinical();
    expect(await screen.findByRole("option", { name: "Wrong examination" })).toBeTruthy();
    expect(screen.getByLabelText(/Clinical\/workflow category/)).toHaveProperty("value", "");
    expect(screen.getByLabelText(/Harm level/)).toHaveProperty("value", "");
    expect(screen.getByRole("option", { name: "Select a clinical / workflow category" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("option", { name: "Select a harm level" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("option", { name: "Reporting issue" })).toBeTruthy();
    await user.type(screen.getByLabelText("Patient (optional)"), "En");
    const result = await screen.findByRole("option", { name: /English Patient.*MRN-22/ }, { timeout: 1500 });
    expect(searchPatients).toHaveBeenCalledWith("En");
    await user.click(result);
    expect(screen.getByTestId("selected-patient-summary").textContent).toContain("MRN-22");
    await user.click(screen.getByRole("button", { name: "Change / Clear patient" }));
    expect(screen.getByLabelText("Patient (optional)")).toBeTruthy();
  });

  it("requires a conscious Equipment condition selection", async () => {
    renderPage(); await openCreate();
    expect(screen.getByRole("radio", { name: "Operational" })).toHaveProperty("checked", false);
    expect(screen.getByRole("radio", { name: "Degraded" })).toHaveProperty("checked", false);
    expect(screen.getByRole("radio", { name: "Out of service" })).toHaveProperty("checked", false);
  });

  it("resets stale type-specific and form state on Cancel", async () => {
    const user = userEvent.setup(); renderPage(); await openCreate(); await chooseClinical();
    await user.type(screen.getByLabelText("Patient (optional)"), "En");
    await user.click(await screen.findByRole("option", { name: /English Patient/ }, { timeout: 1500 }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await openCreate();
    expect(screen.getByRole("radio", { name: "Equipment / Device Incident" })).toHaveProperty("checked", true);
    expect(screen.queryByText("MRN-22")).toBeNull();
  });

  it("lists, limits, and removes selected attachments", async () => {
    renderPage(); await openCreate();
    const input = document.querySelector("input[type='file']") as HTMLInputElement;
    const selected = Array.from({ length: 6 }, (_, index) => new File(["x"], `file-${index}.pdf`, { type: "application/pdf" }));
    fireEvent.change(input, { target: { files: selected } });
    expect(screen.getByText("Only the first 5 files were selected.")).toBeTruthy();
    expect(screen.queryByText("file-5.pdf")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Remove file-0.pdf" }));
    expect(screen.queryByText("file-0.pdf")).toBeNull();
  });

  it("keeps a created incident and opens detail with a warning after partial upload failure", async () => {
    const user = userEvent.setup(); api.uploadIncidentAttachment.mockRejectedValueOnce(new Error("upload failed")); renderPage(); await openCreate();
    await user.selectOptions(screen.getByLabelText(/Equipment name/), "1");
    await user.click(screen.getByRole("radio", { name: "Operational" }));
    await user.type(screen.getByLabelText(/Description of incident/), "Issue");
    fireEvent.change(document.querySelector("input[type='file']")!, { target: { files: [new File(["x"], "failed.pdf", { type: "application/pdf" })] } });
    await user.click(screen.getByRole("button", { name: "Submit incident" }));
    expect(await screen.findByText("The incident was created, but one or more attachments failed to upload.")).toBeTruthy();
    expect(api.createIncident).toHaveBeenCalledTimes(1);
  });

  it("shows a localized create error with the safe API message", async () => {
    const user = userEvent.setup(); api.createIncident.mockRejectedValueOnce(new Error("Request rejected")); renderPage(); await openCreate();
    await user.selectOptions(screen.getByLabelText(/Equipment name/), "1");
    await user.click(screen.getByRole("radio", { name: "Operational" }));
    await user.type(screen.getByLabelText(/Description of incident/), "Issue");
    await user.click(screen.getByRole("button", { name: "Submit incident" }));
    expect(await screen.findByText("Unable to submit the incident.")).toBeTruthy();
    expect(screen.getByText("Request rejected")).toBeTruthy();
  });

  it("shows structured detail, attachment and print actions, and reviewer validation", async () => {
    const user = userEvent.setup(); renderPage();
    await user.click(await screen.findByRole("button", { name: /INC-000007/ }));
    expect(await screen.findByText("Equipment details")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open/ }).getAttribute("href")).toBe("/api/documents/1/view");
    await user.click(screen.getByRole("button", { name: "Print incident report" }));
    expect(printIncidentReport).toHaveBeenCalled();
    await user.selectOptions(document.querySelector("#review-status")!, "resolved");
    await user.click(screen.getByRole("button", { name: "Save review" }));
    expect(screen.getByText("Review notes are required for resolved or closed incidents.")).toBeTruthy();
    expect(api.reviewIncident).not.toHaveBeenCalled();
  });

  it("shows a review API failure without closing detail", async () => {
    const user = userEvent.setup(); api.reviewIncident.mockRejectedValueOnce(new Error("Review rejected")); renderPage();
    await user.click(await screen.findByRole("button", { name: /INC-000007/ }));
    await user.selectOptions(document.querySelector("#review-status")!, "under_review");
    await user.type(screen.getByLabelText("Review / corrective action"), "Review note");
    await user.click(screen.getByRole("button", { name: "Save review" }));
    expect(await screen.findByText("Unable to save the review.")).toBeTruthy();
    expect(screen.getByText("Review rejected")).toBeTruthy();
    expect(screen.getByText("Equipment details")).toBeTruthy();
  });

  it("shows clinical detail and the explicit no-attachment state", async () => {
    const user = userEvent.setup(); api.fetchIncident.mockResolvedValueOnce({ incident: clinicalIncident }); api.listIncidentAttachments.mockResolvedValueOnce({ documents: [] }); renderPage();
    await user.click(await screen.findByRole("button", { name: /INC-000008/ }));
    expect(await screen.findByText("Clinical / workflow details")).toBeTruthy();
    expect(screen.getByText("MRN-8")).toHaveProperty("dir", "ltr");
    expect(screen.getByText("No attachments")).toBeTruthy();
  });

  it("shows attachment failure with Retry and blocks printing until metadata succeeds", async () => {
    const user = userEvent.setup(); api.listIncidentAttachments.mockRejectedValueOnce(new Error("attachments down")); renderPage();
    await user.click(await screen.findByRole("button", { name: /INC-000007/ }));
    expect(await screen.findByText("Unable to load attachments.")).toBeTruthy();
    expect(screen.queryByText("No attachments")).toBeNull();
    expect(screen.getByRole("button", { name: "Print incident report" })).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("link", { name: /Open/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Print incident report" })).toHaveProperty("disabled", false);
  });

  it("shows Equipment loading, error/retry, and empty states while submission stays unavailable", async () => {
    api.fetchIncidentEquipment.mockImplementationOnce(() => new Promise(() => {}));
    const loading = renderPage(); await openCreate();
    expect(await screen.findByText("Loading equipment…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Submit incident" })).toHaveProperty("disabled", true);
    loading.unmount();

    api.fetchIncidentEquipment.mockRejectedValueOnce(new Error("equipment down"));
    const failed = renderPage(); await openCreate();
    expect(await screen.findByText("Unable to load equipment.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Submit incident" })).toHaveProperty("disabled", true);
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByLabelText(/Equipment name/)).toBeTruthy();
    failed.unmount();

    api.fetchIncidentEquipment.mockResolvedValueOnce({ equipment: [] });
    renderPage(); await openCreate();
    expect(await screen.findByText("No active equipment is available.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Submit incident" })).toHaveProperty("disabled", true);
  });

  it.each(["administrative", "super_admin"])("shows reviewer controls for %s", async (role) => {
    const user = userEvent.setup(); renderPage(role);
    await user.click(await screen.findByRole("button", { name: /INC-000007/ }));
    expect(await screen.findByRole("button", { name: "Save review" })).toBeTruthy();
  });

  it("keeps review state aligned with a successful review response", async () => {
    const user = userEvent.setup();
    api.reviewIncident.mockResolvedValueOnce({ incident: { ...equipmentIncident, status: "resolved", review_notes: "Server-confirmed review" } });
    renderPage();
    await user.click(await screen.findByRole("button", { name: /INC-000007/ }));
    const reviewStatus = await screen.findByLabelText("Status", { selector: "#review-status" });
    await user.selectOptions(reviewStatus, "action_required");
    const reviewNotes = screen.getByLabelText("Review / corrective action");
    await user.type(reviewNotes, "Client review");
    await user.click(screen.getByRole("button", { name: "Save review" }));
    await waitFor(() => expect(api.reviewIncident).toHaveBeenCalledWith(7, { status: "action_required", reviewNotes: "Client review" }));
    await waitFor(() => expect(reviewStatus).toHaveProperty("value", "resolved"));
    expect(reviewNotes).toHaveProperty("value", "Server-confirmed review");
  });

  it.each(["receptionist", "modality_staff", "doctor"])("hides reviewer controls for %s", async (role) => {
    const user = userEvent.setup(); renderPage(role);
    await user.click(await screen.findByRole("button", { name: /INC-000007/ }));
    expect(await screen.findByText("Equipment details")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save review" })).toBeNull();
  });

  it("uses Arabic direction and patient preference while preserving LTR equipment and incident number", async () => {
    renderPage("supervisor", "ar");
    expect(await screen.findByRole("heading", { name: "السلامة والحوادث" })).toBeTruthy();
    expect(await screen.findByText("MRI Scanner A")).toHaveProperty("dir", "ltr");
    expect(screen.getByText("INC-000007")).toHaveProperty("dir", "ltr");
    expect(screen.getByText("مريض عربي")).toBeTruthy();
    expect(screen.getByText("سجل الحوادث")).toBeTruthy();
  });
});
