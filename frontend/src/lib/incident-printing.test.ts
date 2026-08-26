import { beforeEach, describe, expect, it, vi } from "vitest";
import { printIncidentReport } from "./incident-printing";

const equipmentIncident = (overrides = {}) => ({ id: 1, incidentNumber: "INC-1", incident_type: "equipment" as const, status: "submitted" as const, occurred_at: "2026-08-26", created_at: "2026-08-26", description: "<script>", immediate_action: null, review_notes: "<review>", reporter_name: "Reporter", equipment_name: "MRI Scanner A", equipment_type: "MRI", location: "Room 1", equipment_condition: "operational", vendor_contacted: true, vendor_contact_person: "Vendor", vendor_reference: "TICKET-1", patient_arabic_name: null, patient_english_name: null, mrn: null, clinical_category: null, harm_level: null, ...overrides });
describe("printIncidentReport", () => {
  const write = vi.fn();
  beforeEach(() => { write.mockReset(); vi.stubGlobal("window", { open: vi.fn(() => ({ document: { write, close: vi.fn() } })) }); });
  it("renders a structured LTR report with isolated equipment, escaped multiline content, attachments, and print rules", () => {
    printIncidentReport(equipmentIncident(), [{ id: 1, original_filename: "<x>.pdf", mime_type: "text/plain", document_type: "incident_attachment", created_at: "2026-08-26" }], "en");
    const html = String(write.mock.calls[0][0]);
    expect(html).toContain('dir="ltr"'); expect(html).toContain("Incident details"); expect(html).toContain("Equipment details"); expect(html).toContain('class="incident-number isolate"'); expect(html).toContain("MRI Scanner A"); expect(html).toContain("&lt;script&gt;"); expect(html).toContain("&lt;review&gt;"); expect(html).toContain("&lt;x&gt;.pdf"); expect(html).toContain("white-space:pre-wrap"); expect(html).toContain("break-inside:avoid"); expect(html).toContain("@media print{.toolbar{display:none}}");
  });
  it("renders RTL Arabic clinical details with isolated MRN and localized empty attachments", () => {
    printIncidentReport(equipmentIncident({ incident_type: "clinical_workflow", equipment_name: null, patient_arabic_name: "مريض عربي", patient_english_name: "English Patient", mrn: "MRN-1", clinical_category: "wrong_exam", harm_level: "no_harm" }), [], "ar");
    const html = String(write.mock.calls[0][0]);
    expect(html).toContain('dir="rtl"'); expect(html).toContain("مريض عربي"); expect(html).toContain("فحص غير صحيح"); expect(html).toContain("MRN-1"); expect(html).toContain("لا توجد مرفقات");
  });
});
