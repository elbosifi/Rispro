import { t, type Language } from "@/lib/i18n";
import type { Incident, IncidentDocument } from "@/lib/api/incidents";

const escapeHtml = (value: unknown) => String(value ?? "-")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const escapeCssContent = (value: unknown) => String(value ?? "")
  .replace(/\\/g, "\\\\")
  .replace(/"/g, '\\"')
  .replace(/\r\n?|\n/g, "\\A ");

const incidentText = (language: Language, key: string) => t(language, `incidents.${key}` as never);
const incidentLabel = (language: Language, key: string) => escapeHtml(incidentText(language, key));

const printCopy = {
  en: {
    department: "Diagnostic & Interventional Radiology Department",
    currentStatus: "Current status",
    administrativeReview: "Administrative Review / Review Notes",
    reviewedBy: "Reviewed by",
    reportedBy: "Reported by",
    signature: "Signature",
    date: "Date",
    officialStamp: "Official Stamp",
    generated: "Generated",
  },
  ar: {
    department: "قسم الأشعة التشخيصية والتداخلية",
    currentStatus: "الحالة الحالية",
    administrativeReview: "المراجعة الإدارية / ملاحظات المراجعة",
    reviewedBy: "تمت المراجعة بواسطة",
    reportedBy: "مقدم البلاغ",
    signature: "التوقيع",
    date: "التاريخ",
    officialStamp: "الختم الرسمي",
    generated: "تاريخ الإنشاء",
  },
} as const;

type PrintCopyKey = keyof typeof printCopy.en;
const printLabel = (language: Language, key: PrintCopyKey) => escapeHtml(printCopy[language][key]);

const formatDateTime = (value: string, language: Language) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "-"
    : new Intl.DateTimeFormat(language === "ar" ? "ar-LY" : "en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
};

const dataRow = (language: Language, key: string, value: unknown, isolate = false) =>
  `<tr><th scope="row">${incidentLabel(language, key)}</th><td${isolate ? ' class="isolate"' : ""}>${escapeHtml(value)}</td></tr>`;

const reviewRow = (label: string, value: unknown, isolate = false) =>
  `<tr><th scope="row">${label}</th><td${isolate ? ' class="isolate"' : ""}>${escapeHtml(value)}</td></tr>`;

const reportSection = (title: string, content: string, className = "") =>
  `<section class="report-section print-group ${className}"><h2 class="section-heading">${title}</h2>${content}</section>`;

const narrativeSection = (title: string, value: unknown) =>
  reportSection(title, `<div class="narrative-content">${escapeHtml(value)}</div>`, "narrative-section");

export function printIncidentReport(incident: Incident, attachments: IncidentDocument[], language: Language) {
  const rtl = language === "ar";
  const patientName = rtl
    ? incident.patient_arabic_name || incident.patient_english_name
    : incident.patient_english_name || incident.patient_arabic_name;
  const typeKey = incident.incident_type === "equipment" ? "equipmentTypeShort" : "clinicalTypeShort";
  const logoUrl = `${window.location.origin}/assets/nccb-logo.png`;
  const generatedAt = formatDateTime(new Date().toISOString(), language);
  const status = incidentText(language, incident.status);
  const title = incidentLabel(language, "printTitle");
  const continuationIdentity = [
    escapeCssContent("استكمال تقرير الحادث"),
    escapeCssContent("Incident Report - Continued"),
  ].join("\\A ");
  const footerIncidentNumber = escapeCssContent(rtl ? `رقم الحادث: \u2066${incident.incidentNumber}\u2069` : `Incident: ${incident.incidentNumber}`);
  const footerGenerated = escapeCssContent(rtl ? `RISpro · تاريخ الإنشاء: ${generatedAt}` : `RISpro · Generated: ${generatedAt}`);
  const pageFurnitureRules = rtl
    ? `@page {
  @top-center { content: "${continuationIdentity}"; white-space: pre-line; text-align: center; vertical-align: bottom; font: normal 8pt/1.2 "Noto Sans Arabic", Tahoma, Arial, sans-serif; color: #18212b; }
  @bottom-right { content: "${footerIncidentNumber}"; font: normal 8pt "Noto Sans Arabic", Tahoma, Arial, sans-serif; color: #46515b; }
  @bottom-center { content: "${footerGenerated}"; font: normal 8pt "Noto Sans Arabic", Tahoma, Arial, sans-serif; color: #46515b; }
  @bottom-left { content: "الصفحة " counter(page) " من " counter(pages); font: normal 8pt "Noto Sans Arabic", Tahoma, Arial, sans-serif; color: #46515b; }
}
@page :first {
  @top-center { content: ""; }
}`
    : `@page {
  @top-center { content: "${continuationIdentity}"; white-space: pre-line; text-align: center; vertical-align: bottom; font: normal 8pt/1.2 Arial, Helvetica, sans-serif; color: #18212b; }
  @bottom-left { content: "${footerIncidentNumber}"; font: normal 8pt Arial, Helvetica, sans-serif; color: #46515b; }
  @bottom-center { content: "${footerGenerated}"; font: normal 8pt Arial, Helvetica, sans-serif; color: #46515b; }
  @bottom-right { content: "Page " counter(page) " of " counter(pages); font: normal 8pt Arial, Helvetica, sans-serif; color: #46515b; }
}
@page :first {
  @top-center { content: ""; }
}`;

  const identityStrip = `<div class="identity-strip">
    <table class="identity-table" aria-label="${title}"><tbody><tr>
      <td class="identity-cell identity-primary"><span class="field-label">${incidentLabel(language, "incidentNumber")}</span><strong class="incident-number isolate">${escapeHtml(incident.incidentNumber)}</strong></td>
      <td class="identity-cell"><span class="field-label">${printLabel(language, "currentStatus")}</span><span class="field-value">${escapeHtml(status)}</span></td>
      <td class="identity-cell"><span class="field-label">${incidentLabel(language, "occurredAt")}</span><span class="field-value">${escapeHtml(formatDateTime(incident.occurred_at, language))}</span></td>
      <td class="identity-cell"><span class="field-label">${incidentLabel(language, "createdAt")}</span><span class="field-value">${escapeHtml(formatDateTime(incident.created_at, language))}</span></td>
    </tr></tbody></table>
  </div>`;

  const structuredRows = incident.incident_type === "equipment"
    ? [
        dataRow(language, "type", incidentText(language, typeKey)),
        dataRow(language, "reporterDisplay", incident.reporter_name),
        dataRow(language, "equipmentName", incident.equipment_name, true),
        dataRow(language, "equipmentType", incident.equipment_type, true),
        dataRow(language, "location", incident.location),
        dataRow(language, "equipmentCondition", incident.equipment_condition ? incidentText(language, `condition_${incident.equipment_condition}`) : null),
        dataRow(language, "vendorContacted", incidentText(language, incident.vendor_contacted ? "yes" : "no")),
        dataRow(language, "vendorContactPerson", incident.vendor_contact_person),
        dataRow(language, "vendorReference", incident.vendor_reference, true),
      ].join("")
    : [
        dataRow(language, "type", incidentText(language, typeKey)),
        dataRow(language, "reporterDisplay", incident.reporter_name),
        dataRow(language, "patientName", patientName),
        dataRow(language, "mrn", incident.mrn, true),
        dataRow(language, "clinicalCategory", incident.clinical_category ? incidentText(language, incident.clinical_category) : null),
        dataRow(language, "harmLevel", incident.harm_level ? incidentText(language, incident.harm_level) : null),
      ].join("");

  const incidentDetails = reportSection(
    incidentLabel(language, "incidentDetails"),
    `<table class="data-table"><tbody>${structuredRows}</tbody></table>`,
    "structured-section",
  );

  const administrativeReview = reportSection(
    printLabel(language, "administrativeReview"),
    `<table class="data-table review-meta"><tbody>
      ${reviewRow(printLabel(language, "reviewedBy"), incident.reviewer_name)}
      ${reviewRow(printLabel(language, "currentStatus"), status)}
    </tbody></table><div class="subsection-label">${incidentLabel(language, "reviewNotes")}</div><div class="narrative-content review-content">${escapeHtml(incident.review_notes)}</div>`,
    "narrative-section review-section",
  );

  const attachmentContent = attachments.length
    ? `<ol class="attachment-register">${attachments.map((attachment) => `<li><span class="isolate filename">${escapeHtml(attachment.original_filename)}</span></li>`).join("")}</ol>`
    : `<div class="empty-content">${incidentLabel(language, "noAttachments")}</div>`;
  const attachmentSection = reportSection(incidentLabel(language, "attachments"), attachmentContent, "attachments-section");

  const signatureArea = reportSection(
    rtl ? "للاستخدام الرسمي" : "For official use",
    `<div class="signature-grid">
      <div class="signature-block"><h3>${printLabel(language, "reportedBy")}</h3><div class="printed-name">${escapeHtml(incident.reporter_name)}</div><div class="line-field"><span>${printLabel(language, "signature")}</span><span class="blank-line"></span></div><div class="line-field"><span>${printLabel(language, "date")}</span><span class="blank-line"></span></div></div>
      <div class="signature-block"><h3>${printLabel(language, "reviewedBy")}</h3><div class="printed-name">${escapeHtml(incident.reviewer_name)}</div><div class="line-field"><span>${printLabel(language, "signature")}</span><span class="blank-line"></span></div><div class="line-field"><span>${printLabel(language, "date")}</span><span class="blank-line"></span></div></div>
      <div class="stamp-block"><h3>${printLabel(language, "officialStamp")}</h3><div class="stamp-box" aria-label="${printLabel(language, "officialStamp")}"></div></div>
    </div>`,
    "official-use-section",
  );

  const html = `<!doctype html><html lang="${language}" dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8"><title>${title}</title><style>
@page { size: A4 portrait; margin: 14mm 15mm 20mm; }
${pageFurnitureRules}
* { box-sizing: border-box; }
html { background: #fff; }
body { margin: 0; color: #18212b; background: #fff; font: 10.5pt/1.45 Arial, Helvetica, sans-serif; }
body[dir="rtl"] { font-family: "Noto Sans Arabic", Tahoma, Arial, sans-serif; }
.toolbar { display: flex; gap: 2mm; max-width: 180mm; margin: 0 auto 7mm; }
.toolbar button { border: 1px solid #68727c; border-radius: 0; background: #fff; color: #18212b; padding: 2mm 4mm; font: inherit; cursor: pointer; }
.report { width: 100%; max-width: 180mm; margin: 0 auto; }
.print-document { width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed; }
.print-document-header th, .print-body-row > td { padding: 0; border: 0; vertical-align: top; }
.institutional-header { display: grid; direction: ltr; grid-template-columns: minmax(0, 1fr) 24mm minmax(0, 1fr); align-items: center; gap: 4mm; padding-bottom: 4mm; border-bottom: 0.45mm solid #18212b; }
.institutional-english { grid-column: 1; min-width: 0; text-align: center; direction: ltr; }
.logo-cell { grid-column: 2; display: flex; align-items: center; justify-content: center; }
.institutional-logo { display: block; width: 21mm; height: 21mm; object-fit: contain; }
.institutional-arabic { grid-column: 3; min-width: 0; text-align: center; direction: rtl; }
.hospital-ar { margin: 0; font-size: 15pt; font-weight: 800; line-height: 1.35; }
.hospital-en { margin: 0.5mm 0 0; font-size: 12pt; font-weight: 700; line-height: 1.25; }
.department-ar { margin: 2.2mm 0 0; font-size: 10.5pt; font-weight: 700; line-height: 1.35; }
.department-en { margin: 0.5mm 0 0; font-size: 9.5pt; line-height: 1.25; }
.title-block { padding: 4mm 0 3.5mm; text-align: center; border-bottom: 0.8mm solid #18212b; }
.title-ar { margin: 0; font-size: 14pt; font-weight: 800; line-height: 1.35; }
.title-en { margin: 0.7mm 0 0; font-size: 12pt; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; line-height: 1.2; }
.identity-strip { margin: 4.5mm 0 5mm; border: 0.45mm solid #18212b; }
.identity-table, .data-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.identity-cell { width: 23%; padding: 2.4mm 3mm; vertical-align: top; border-inline-start: 0.25mm solid #aeb6bd; }
.identity-cell:first-child { border-inline-start: 0; }
.identity-primary { width: 31%; }
.field-label { display: block; margin-bottom: 1mm; color: #46515b; font-size: 8.5pt; font-weight: 700; }
.field-value { display: block; overflow-wrap: anywhere; }
.incident-number { display: block; color: #111820; font-size: 14pt; font-weight: 800; line-height: 1.2; }
.report-section { margin: 0 0 4.5mm; border: 0.3mm solid #68727c; }
.section-heading { margin: 0; padding: 2mm 3mm; border-bottom: 0.25mm solid #68727c; background: #eef0f2; color: #18212b; font-size: 10.5pt; font-weight: 800; line-height: 1.3; }
.data-table th, .data-table td { padding: 2.2mm 3mm; vertical-align: top; text-align: start; border-bottom: 0.2mm solid #cbd1d6; overflow-wrap: anywhere; word-break: break-word; }
.data-table tr:last-child th, .data-table tr:last-child td { border-bottom: 0; }
.data-table th { width: 32%; color: #46515b; font-weight: 700; }
.data-table td { min-width: 0; }
.narrative-content { min-height: 13mm; padding: 3mm; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; orphans: 3; widows: 3; }
.review-meta th, .review-meta td { padding-top: 2mm; padding-bottom: 2mm; }
.subsection-label { padding: 2.5mm 3mm 0; color: #46515b; font-size: 8.5pt; font-weight: 700; }
.review-content { min-height: 12mm; padding-top: 1.5mm; }
.attachment-register { margin: 0; padding: 2mm 8mm 2mm 10mm; }
body[dir="rtl"] .attachment-register { padding: 2mm 10mm 2mm 8mm; }
.attachment-register li { padding: 2mm 0; border-bottom: 0.2mm solid #cbd1d6; overflow-wrap: anywhere; }
.attachment-register li:last-child { border-bottom: 0; }
.filename { overflow-wrap: anywhere; word-break: break-word; }
.empty-content { padding: 4mm 3mm; color: #46515b; }
.official-use-section { break-inside: avoid-page; page-break-inside: avoid; }
.signature-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 5mm; padding: 4mm 3mm 5mm; }
.signature-block, .stamp-block { min-width: 0; }
.signature-block h3, .stamp-block h3 { margin: 0 0 2.5mm; font-size: 9.5pt; font-weight: 800; }
.printed-name { min-height: 7mm; padding-bottom: 1.5mm; border-bottom: 0.2mm solid #68727c; overflow-wrap: anywhere; }
.line-field { display: flex; align-items: end; gap: 2mm; min-height: 8mm; padding-top: 2mm; color: #46515b; font-size: 8.5pt; }
.blank-line { flex: 1; min-width: 12mm; border-bottom: 0.2mm solid #68727c; }
.stamp-box { min-height: 27mm; border: 0.3mm solid #68727c; }
.report-footer { display: flex; justify-content: space-between; gap: 6mm; margin-top: 5mm; padding-top: 2.5mm; border-top: 0.25mm solid #68727c; color: #46515b; font-size: 8pt; }
.report-footer > span { min-width: 0; overflow-wrap: anywhere; }
.isolate { direction: ltr; text-align: left; unicode-bidi: isolate; }
@media screen and (max-width: 720px) { .identity-table, .identity-table tbody, .identity-table tr, .identity-cell { display: block; width: 100%; } .identity-cell { border-inline-start: 0; border-top: 0.2mm solid #aeb6bd; } .identity-cell:first-child { border-top: 0; } .signature-grid { grid-template-columns: 1fr; } .stamp-box { min-height: 22mm; } }
@media print { .toolbar, .report-footer { display: none; } .report { max-width: none; } .print-document-header { display: table-header-group; } .print-document-header tr, .print-document-header th, .institutional-header { break-inside: avoid; page-break-inside: avoid; } .section-heading { break-after: avoid-page; page-break-after: avoid; } .print-group { break-inside: avoid-page; page-break-inside: avoid; } .report-intro-group { break-inside: avoid-page; page-break-inside: avoid; } .data-table tr { break-inside: avoid; page-break-inside: avoid; } .attachment-register li { break-inside: avoid; page-break-inside: avoid; } a { color: inherit; text-decoration: none; } }
</style><script>function printReportWhenReady(){const logo=document.querySelector(".institutional-logo");if(!logo||logo.complete){window.print();return;}const print=()=>window.print();logo.addEventListener("load",print,{once:true});logo.addEventListener("error",print,{once:true});}</script></head><body><div class="toolbar"><button type="button" onclick="printReportWhenReady()">${incidentLabel(language, "print")}</button><button type="button" onclick="window.close()">${incidentLabel(language, "close")}</button></div><main class="report"><table class="print-document"><thead class="print-document-header"><tr><th><header class="institutional-header"><div class="institutional-english" dir="ltr"><p class="hospital-en">${escapeHtml(t("en", "brand.hospitalName"))}</p><p class="department-en">${escapeHtml(printCopy.en.department)}</p></div><div class="logo-cell"><img class="institutional-logo" src="${escapeHtml(logoUrl)}" alt="NCCB logo"></div><div class="institutional-arabic" dir="rtl"><p class="hospital-ar">${escapeHtml(t("ar", "brand.hospitalName"))}</p><p class="department-ar">${escapeHtml(printCopy.ar.department)}</p></div></header></th></tr></thead><tbody>
  <tr class="print-body-row"><td><div class="report-intro-group"><div class="title-block"><p class="title-ar" dir="rtl">تقرير حادث</p><p class="title-en" dir="ltr">Incident Report</p></div>
  ${identityStrip}</div></td></tr>
  <tr class="print-body-row"><td>${incidentDetails}</td></tr>
  <tr class="print-body-row"><td>${narrativeSection(incidentLabel(language, "description"), incident.description)}</td></tr>
  <tr class="print-body-row"><td>${narrativeSection(incidentLabel(language, "immediateAction"), incident.immediate_action)}</td></tr>
  <tr class="print-body-row"><td>${administrativeReview}</td></tr>
  <tr class="print-body-row"><td>${attachmentSection}</td></tr>
  <tr class="print-body-row"><td>${signatureArea}</td></tr>
</tbody></table>
  <footer class="report-footer"><span>${incidentLabel(language, "incidentNumber")}: <span class="isolate">${escapeHtml(incident.incidentNumber)}</span></span><span>${printLabel(language, "generated")}: ${escapeHtml(generatedAt)} · RISpro</span></footer>
</main></body></html>`;

  const printWindow = window.open("", "_blank", "width=900,height=800");
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
  }
}
