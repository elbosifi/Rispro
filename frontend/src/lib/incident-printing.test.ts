import { beforeEach, describe, expect, it, vi } from "vitest";
import { printIncidentReport } from "./incident-printing";

const equipmentIncident = (overrides = {}) => ({ id: 1, incidentNumber: "INC-1", incident_type: "equipment" as const, status: "submitted" as const, occurred_at: "2026-08-26", created_at: "2026-08-26", description: "<script>", immediate_action: "Stopped scanner\nPlaced warning notice", review_notes: "<review>", reporter_name: "Reporter", reviewer_name: "Reviewer", equipment_name: "MRI Scanner A", equipment_type: "MRI", location: "Room 1", equipment_condition: "operational", vendor_contacted: true, vendor_contact_person: "Vendor", vendor_reference: "TICKET-1", patient_arabic_name: null, patient_english_name: null, mrn: null, clinical_category: null, harm_level: null, ...overrides });
describe("printIncidentReport", () => {
  const write = vi.fn();
  beforeEach(() => { write.mockReset(); vi.stubGlobal("window", { location: { origin: "https://rispro.test" }, open: vi.fn(() => ({ document: { write, close: vi.fn() } })) }); });
  it("renders a formal A4 LTR NCCB report with structured details, narratives, signatures, and print rules", () => {
    printIncidentReport(equipmentIncident(), [{ id: 1, original_filename: "<x>.pdf", mime_type: "text/plain", document_type: "incident_attachment", created_at: "2026-08-26" }], "en");
    const html = String(write.mock.calls[0][0]);
    expect(html).toContain('lang="en" dir="ltr"'); expect(html).toContain('@page { size: A4 portrait; margin: 14mm 15mm 15mm; }'); expect(html).toContain("https://rispro.test/assets/nccb-logo.png"); expect(html).toContain("National Cancer Center Benghazi"); expect(html).toContain("Diagnostic &amp; Interventional Radiology Department"); expect(html).toContain("Incident Report"); expect(html).toContain("INC-1"); expect(html).toContain("Description of incident"); expect(html).toContain("Immediate action taken"); expect(html).toContain("Administrative Review / Review Notes"); expect(html).toContain("MRI Scanner A"); expect(html).toContain("Reviewer"); expect(html).toContain("&lt;script&gt;"); expect(html).toContain("Stopped scanner\nPlaced warning notice"); expect(html).toContain("&lt;review&gt;"); expect(html).toContain("&lt;x&gt;.pdf"); expect(html).toContain("white-space: pre-wrap"); expect(html).toContain("Official Stamp"); expect(html).toContain('class="incident-number isolate"'); expect(html).toContain("@media print");
  });
  it("renders an Arabic RTL report with bilingual header, localized sections, and isolated MRN", () => {
    printIncidentReport(equipmentIncident({ incident_type: "clinical_workflow", equipment_name: null, patient_arabic_name: "مريض عربي", patient_english_name: "English Patient", mrn: "MRN-1", clinical_category: "wrong_exam", harm_level: "no_harm" }), [], "ar");
    const html = String(write.mock.calls[0][0]);
    expect(html).toContain('lang="ar" dir="rtl"'); expect(html).toContain("المركز الوطني للأورام بنغازي"); expect(html).toContain("مريض عربي"); expect(html).toContain("فحص غير صحيح"); expect(html).toContain("MRN-1"); expect(html).toContain('class="isolate"'); expect(html).toContain("لا توجد مرفقات"); expect(html).toContain("قسم الأشعة التشخيصية والتداخلية"); expect(html).toContain("National Cancer Center Benghazi");
  });
  it("keeps the report document LTR in English", () => {
    printIncidentReport(equipmentIncident(), [], "en");
    const html = String(write.mock.calls[0][0]);
    expect(html).toContain('lang="en" dir="ltr"'); expect(html).toContain('class="isolate"');
  });
});
