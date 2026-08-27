import { t, type Language } from "@/lib/i18n";
import type { Incident, IncidentDocument } from "@/lib/api/incidents";

const escape = (value: unknown) => String(value ?? "-").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const text = (language: Language, key: string) => t(language, `incidents.${key}` as never);
const label = (language: Language, key: string) => escape(text(language, key));
const formatDateTime = (value: string, language: Language) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat(language === "ar" ? "ar-LY" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
};
const row = (language: Language, key: string, value: unknown, isolate = false, multiline = false) =>
  `<div class="row"><div class="label">${label(language, key)}</div><div class="value${isolate ? " isolate" : ""}${multiline ? " multiline" : ""}">${escape(value)}</div></div>`;
const section = (title: string, content: string) => `<section><h3>${title}</h3><div class="section-body">${content}</div></section>`;

export function printIncidentReport(incident: Incident, attachments: IncidentDocument[], language: Language) {
  const rtl = language === "ar";
  const patientName = rtl ? incident.patient_arabic_name || incident.patient_english_name : incident.patient_english_name || incident.patient_arabic_name;
  const typeKey = incident.incident_type === "equipment" ? "equipmentTypeShort" : "clinicalTypeShort";
  const summary = `<div class="summary"><div><span class="eyebrow">${label(language, "incidentNumber")}</span><strong class="incident-number isolate">${escape(incident.incidentNumber)}</strong></div><div class="chips"><span>${label(language, typeKey)}</span><span>${label(language, incident.status)}</span></div></div>`;
  const common = section(label(language, "incidentDetails"), [
    row(language, "occurredAt", formatDateTime(incident.occurred_at, language)),
    row(language, "reporterDisplay", incident.reporter_name),
    row(language, "createdAt", formatDateTime(incident.created_at, language)),
    row(language, "description", incident.description, false, true),
    row(language, "immediateAction", incident.immediate_action, false, true),
    row(language, "reviewNotes", incident.review_notes, false, true),
  ].join(""));
  const details = incident.incident_type === "equipment"
    ? section(label(language, "equipmentDetails"), [
        row(language, "equipmentName", incident.equipment_name, true),
        row(language, "equipmentType", incident.equipment_type, true),
        row(language, "location", incident.location, true),
        row(language, "equipmentCondition", incident.equipment_condition ? text(language, `condition_${incident.equipment_condition}`) : null),
        row(language, "vendorContacted", text(language, incident.vendor_contacted ? "yes" : "no")),
        row(language, "vendorContactPerson", incident.vendor_contact_person),
        row(language, "vendorReference", incident.vendor_reference, true),
      ].join(""))
    : section(label(language, "clinicalDetails"), [
        row(language, "patientName", patientName),
        row(language, "mrn", incident.mrn, true),
        row(language, "clinicalCategory", incident.clinical_category ? text(language, incident.clinical_category) : null),
        row(language, "harmLevel", incident.harm_level ? text(language, incident.harm_level) : null),
      ].join(""));
  const attachmentRows = attachments.length
    ? attachments.map((attachment) => `<div class="attachment isolate">${escape(attachment.original_filename)}</div>`).join("")
    : `<div class="empty">${label(language, "noAttachments")}</div>`;
  const html = `<!doctype html><html lang="${language}" dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8"><title>${label(language, "printTitle")}</title><style>
@page{margin:16mm}*{box-sizing:border-box}body{margin:0;color:#17202a;font:14px/1.5 Arial,sans-serif}.toolbar{display:flex;gap:8px;margin-bottom:20px}.toolbar button{border:1px solid #aeb6bf;border-radius:6px;background:#fff;padding:8px 14px}header{border-bottom:2px solid #34495e;padding-bottom:14px;margin-bottom:18px}h1{font-size:20px;margin:0}h2{font-size:16px;margin:4px 0 0;color:#566573}.summary{display:flex;justify-content:space-between;gap:16px;align-items:end;border:1px solid #d5d8dc;border-radius:8px;background:#f8f9f9;padding:14px;margin-bottom:16px}.eyebrow{display:block;color:#626567;font-size:11px;text-transform:uppercase}.incident-number{display:block;font-size:20px;margin-top:2px}.chips{display:flex;gap:6px;flex-wrap:wrap}.chips span{border:1px solid #bdc3c7;border-radius:999px;padding:3px 9px;font-size:12px}section{border:1px solid #d5d8dc;border-radius:8px;margin:0 0 14px;break-inside:avoid}h3{font-size:14px;margin:0;padding:9px 12px;background:#f2f3f4;border-bottom:1px solid #d5d8dc}.section-body{padding:3px 12px}.row{display:grid;grid-template-columns:minmax(150px,30%) 1fr;gap:12px;padding:7px 0;border-bottom:1px solid #eaeded}.row:last-child{border-bottom:0}.label{font-weight:700;color:#566573}.value{min-width:0}.multiline{white-space:pre-wrap}.isolate{direction:ltr;text-align:left;unicode-bidi:isolate}.attachment{padding:7px 0;border-bottom:1px solid #eaeded}.attachment:last-child{border-bottom:0}.empty{padding:7px 0;color:#626567}@media(max-width:520px){.summary{align-items:start;flex-direction:column}.row{grid-template-columns:1fr}.label{margin-bottom:-8px}}@media print{.toolbar{display:none}}
</style></head><body><div class="toolbar"><button onclick="window.print()">${label(language, "print")}</button><button onclick="window.close()">${label(language, "close")}</button></div><header><h1>${escape(t(language, "brand.hospitalName"))}</h1><h2>${label(language, "printTitle")}</h2></header>${summary}${common}${details}${section(label(language, "attachments"), attachmentRows)}</body></html>`;
  const printWindow = window.open("", "_blank", "width=900,height=800");
  if (printWindow) { printWindow.document.write(html); printWindow.document.close(); }
}
