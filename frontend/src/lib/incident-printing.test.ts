import { beforeEach, describe, expect, it, vi } from "vitest";
import { printIncidentReport } from "./incident-printing";

const equipmentIncident = (overrides = {}) => ({
  id: 1,
  incidentNumber: "INC-1",
  incident_type: "equipment" as const,
  status: "submitted" as const,
  occurred_at: "2026-08-26",
  created_at: "2026-08-26",
  description: "<script>",
  immediate_action: "Stopped scanner\nPlaced warning notice",
  review_notes: "<review>",
  reporter_name: "Reporter",
  reviewer_name: "Reviewer",
  equipment_name: "MRI Scanner A",
  equipment_type: "MRI",
  location: "Room 1",
  equipment_condition: "operational",
  vendor_contacted: true,
  vendor_contact_person: "Vendor",
  vendor_reference: "TICKET-1",
  patient_arabic_name: null,
  patient_english_name: null,
  mrn: null,
  clinical_category: null,
  harm_level: null,
  ...overrides,
});

describe("printIncidentReport", () => {
  const write = vi.fn();

  beforeEach(() => {
    write.mockReset();
    vi.stubGlobal("window", {
      location: { origin: "https://rispro.test" },
      open: vi.fn(() => ({ document: { write, close: vi.fn() } })),
    });
  });

  it("renders an A4 LTR report with a repeated three-column table header and retained page furniture", () => {
    printIncidentReport(equipmentIncident(), [{ id: 1, original_filename: "<x>.pdf", mime_type: "text/plain", document_type: "incident_attachment", created_at: "2026-08-26" }], "en");
    const html = String(write.mock.calls[0][0]);

    expect(html).toContain('lang="en" dir="ltr"');
    expect(html).toContain('@page { size: A4 portrait; margin: 14mm 15mm 20mm; }');
    expect(html).toContain('@top-center { content: "استكمال تقرير الحادث\\A Incident Report - Continued";');
    expect(html).toContain('@page :first {\n  @top-center { content: ""; }');
    expect(html).not.toContain('@top-left { content:');
    expect(html).not.toContain('@top-right { content:');
    expect(html).toContain('@bottom-left { content: "Incident: INC-1"');
    expect(html).toContain('@bottom-center { content: "RISpro · Generated:');
    expect(html).toContain('@bottom-right { content: "Page " counter(page) " of " counter(pages);');
    expect(html).toContain("counter(page)");
    expect(html).toContain("counter(pages)");

    expect(html).toContain('<table class="print-document"><thead class="print-document-header"><tr><th><header class="institutional-header">');
    expect(html).toMatch(/<thead class="print-document-header"><tr><th><header class="institutional-header"><div class="institutional-english" dir="ltr">[\s\S]*?<div class="logo-cell"><img class="institutional-logo" src="https:\/\/rispro\.test\/assets\/nccb-logo\.png" alt="NCCB logo"><\/div><div class="institutional-arabic" dir="rtl">/);
    expect(html).toContain('.institutional-header { display: grid; direction: ltr; grid-template-columns: minmax(0, 1fr) 24mm minmax(0, 1fr);');
    expect(html).toContain('.institutional-english { grid-column: 1; min-width: 0; text-align: center; direction: ltr; }');
    expect(html).toContain('.logo-cell { grid-column: 2;');
    expect(html).toContain('.institutional-arabic { grid-column: 3; min-width: 0; text-align: center; direction: rtl; }');
    expect(html).toContain('.print-document { width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed; }');
    expect(html).toContain('.print-document-header th, .print-body-row > td { padding: 0; border: 0; vertical-align: top; }');
    expect(html).toContain('.print-document-header { display: table-header-group; }');
    expect(html).toContain('.print-document-header tr, .print-document-header th, .institutional-header { break-inside: avoid; page-break-inside: avoid; }');
    expect(html).not.toContain("print-running-logo");
    expect(html).not.toContain("position: fixed");
    expect(html).toContain('.toolbar, .report-footer { display: none; }');

    expect(html).toContain("National Cancer Center Benghazi");
    expect(html).toContain("Diagnostic &amp; Interventional Radiology Department");
    expect(html).toContain("Incident Report");
    expect(html).toContain("INC-1");
    expect(html).toContain("Description of incident");
    expect(html).toContain("Immediate action taken");
    expect(html).toContain("Administrative Review / Review Notes");
    expect(html).toContain("MRI Scanner A");
    expect(html).toContain("Reviewer");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Stopped scanner\nPlaced warning notice");
    expect(html).toContain("&lt;review&gt;");
    expect(html).toContain("&lt;x&gt;.pdf");
    expect(html).toContain("white-space: pre-wrap");
    expect(html).toContain("Official Stamp");
    expect(html).toContain('class="incident-number isolate"');
    expect(html).toContain("printReportWhenReady");
    expect(html.match(/<header class="institutional-header">/g)).toHaveLength(1);
    expect(html.match(/<div class="title-block">/g)).toHaveLength(1);
  });

  it("uses semantic table body rows and keeps their report groups together where possible", () => {
    printIncidentReport(equipmentIncident(), [{ id: 1, original_filename: "attachment.pdf", mime_type: "text/plain", document_type: "incident_attachment", created_at: "2026-08-26" }], "en");
    const html = String(write.mock.calls[0][0]);

    expect(html.match(/<tr class="print-body-row">/g)).toHaveLength(7);
    expect(html).toMatch(/<tbody>\s*<tr class="print-body-row"><td><div class="report-intro-group"><div class="title-block">[\s\S]*?<div class="identity-strip">/);
    expect(html).toContain('class="report-section print-group structured-section"');
    expect(html).toContain('class="report-section print-group narrative-section"');
    expect(html).toContain('class="report-section print-group narrative-section review-section"');
    expect(html).toContain('class="report-section print-group attachments-section"');
    expect(html).toContain('class="report-section print-group official-use-section"');
    expect(html).toContain('.print-group { break-inside: avoid-page; page-break-inside: avoid; }');
    expect(html).toContain('.section-heading { break-after: avoid-page; page-break-after: avoid; }');
    expect(html).not.toContain('.narrative-section { break-inside: auto; }');
    expect(html).toContain('.narrative-content { min-height: 13mm; padding: 3mm; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; orphans: 3; widows: 3; }');
    expect(html).toContain('.data-table tr { break-inside: avoid; page-break-inside: avoid; }');
    expect(html).toContain('.attachment-register li { break-inside: avoid; page-break-inside: avoid; }');
    expect(html).toContain('.official-use-section { break-inside: avoid-page; page-break-inside: avoid; }');
    expect(html).toContain('.report-intro-group { break-inside: avoid-page; page-break-inside: avoid; }');
  });

  it("renders an Arabic RTL report with the same table header and isolated footer identifier", () => {
    printIncidentReport(equipmentIncident({ incident_type: "clinical_workflow", equipment_name: null, patient_arabic_name: "مريض عربي", patient_english_name: "English Patient", mrn: "MRN-1", clinical_category: "wrong_exam", harm_level: "no_harm" }), [], "ar");
    const html = String(write.mock.calls[0][0]);

    expect(html).toContain('lang="ar" dir="rtl"');
    expect(html).toContain('<thead class="print-document-header">');
    expect(html).toContain('<div class="institutional-english" dir="ltr">');
    expect(html).toContain('<div class="institutional-arabic" dir="rtl">');
    expect(html).toContain('<img class="institutional-logo" src="https://rispro.test/assets/nccb-logo.png" alt="NCCB logo">');
    expect(html).toContain('@top-center { content: "استكمال تقرير الحادث\\A Incident Report - Continued";');
    expect(html).toContain('@page :first {\n  @top-center { content: ""; }');
    expect(html).not.toContain('@top-left { content:');
    expect(html).not.toContain('@top-right { content:');
    expect(html).toContain('@bottom-right { content: "رقم الحادث: ⁦INC-1⁩"');
    expect(html).toContain('@bottom-center { content: "RISpro · تاريخ الإنشاء:');
    expect(html).toContain('@bottom-left { content: "الصفحة " counter(page) " من " counter(pages);');
    expect(html).toContain("counter(page)");
    expect(html).toContain("counter(pages)");
    expect(html).not.toContain("print-running-logo");
    expect(html).not.toContain("position: fixed");
    expect(html).toContain("المركز الوطني للأورام بنغازي");
    expect(html).toContain("مريض عربي");
    expect(html).toContain("فحص غير صحيح");
    expect(html).toContain("MRN-1");
    expect(html).toContain('class="isolate"');
    expect(html).toContain("لا توجد مرفقات");
    expect(html).toContain("قسم الأشعة التشخيصية والتداخلية");
    expect(html).toContain("National Cancer Center Benghazi");
    expect(html.match(/<header class="institutional-header">/g)).toHaveLength(1);
    expect(html.match(/<div class="title-block">/g)).toHaveLength(1);
  });

  it("keeps the report document LTR in English", () => {
    printIncidentReport(equipmentIncident(), [], "en");
    const html = String(write.mock.calls[0][0]);
    expect(html).toContain('lang="en" dir="ltr"');
    expect(html).toContain('class="isolate"');
  });

  it("uses stored reporter and reviewer bilingual snapshots for both print languages", () => {
    const incident = equipmentIncident({
      reporter_name: "Legacy Reporter",
      reporter_name_ar: "Arabic Reporter",
      reporter_name_en: "English Reporter",
      reporter_username: "old.reporter",
      reviewer_name: "Legacy Reviewer",
      reviewer_name_ar: "Arabic Reviewer",
      reviewer_name_en: "English Reviewer",
      reviewer_username: "old.reviewer",
    });

    printIncidentReport(incident, [], "en");
    const englishHtml = String(write.mock.calls[0][0]);
    expect(englishHtml).toContain("English Reporter");
    expect(englishHtml).toContain("English Reviewer");

    printIncidentReport(incident, [], "ar");
    const arabicHtml = String(write.mock.calls[1][0]);
    expect(arabicHtml).toContain("Arabic Reporter");
    expect(arabicHtml).toContain("Arabic Reviewer");
  });
});
