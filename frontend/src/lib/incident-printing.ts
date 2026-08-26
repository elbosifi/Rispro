import { t, type Language } from "@/lib/i18n";
import type { Incident, IncidentDocument } from "@/lib/api/incidents";

const escape = (value: unknown) =>
  String(value ?? "-")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
const label = (language: Language, key: string) =>
  escape(t(language, `incidents.${key}` as never));
const row = (
  language: Language,
  key: string,
  value: unknown,
  equipment = false,
) =>
  `<div class="row${equipment ? " equipment" : ""}"><b>${label(language, key)}</b>: ${escape(value)}</div>`;
const formatLocalDateTime = (value: string, language: Language) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(language === "ar" ? "ar-LY" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

export function printIncidentReport(
  incident: Incident,
  attachments: IncidentDocument[],
  language: Language,
) {
  const rtl = language === "ar";
  const patientName = rtl
    ? incident.patient_arabic_name || incident.patient_english_name
    : incident.patient_english_name || incident.patient_arabic_name;
  const common = [
    row(language, "incidentNumber", incident.incidentNumber),
    row(language, "status", label(language, incident.status)),
    row(language, "type", label(language, incident.incident_type)),
    row(language, "occurredAt", formatLocalDateTime(incident.occurred_at, language)),
    row(language, "reporter", incident.reporter_name),
    row(language, "createdAt", formatLocalDateTime(incident.created_at, language)),
    row(language, "description", incident.description),
    row(language, "immediateAction", incident.immediate_action),
    row(language, "reviewNotes", incident.review_notes),
  ].join("");
  const details =
    incident.incident_type === "equipment"
      ? `<h3>${label(language, "equipment")}</h3>${row(language, "equipmentName", incident.equipment_name, true)}${row(language, "equipmentType", incident.equipment_type, true)}${row(language, "location", incident.location, true)}${row(language, "equipmentCondition", incident.equipment_condition && label(language, incident.equipment_condition))}${row(language, "vendorContacted", label(language, incident.vendor_contacted ? "yes" : "no"))}${row(language, "vendorContactPerson", incident.vendor_contact_person)}${row(language, "vendorReference", incident.vendor_reference)}`
      : `<h3>${label(language, "clinical")}</h3>${row(language, "patientName", patientName)}${row(language, "mrn", incident.mrn)}${row(language, "clinicalCategory", incident.clinical_category && label(language, incident.clinical_category))}${row(language, "harmLevel", incident.harm_level && label(language, incident.harm_level))}`;
  const html = `<!doctype html><html dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8"><title>${label(language, "printTitle")}</title><style>body{font:14px Arial;margin:28px}.toolbar{margin-bottom:16px}.row{padding:6px;border-bottom:1px solid #ddd}.equipment{direction:ltr;text-align:left}@media print{.toolbar{display:none}}</style></head><body><div class="toolbar"><button onclick="window.print()">${label(language, "print")}</button><button onclick="window.close()">${label(language, "close")}</button></div><h1>${escape(t(language, "brand.hospitalName"))}</h1><h2>${label(language, "printTitle")}</h2>${common}${details}<h3>${label(language, "attachments")}</h3>${attachments.map((attachment) => `<div>${escape(attachment.original_filename)}</div>`).join("")}</body></html>`;
  const printWindow = window.open("", "_blank", "width=900,height=800");
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
  }
}
