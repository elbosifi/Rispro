import { HttpError } from "../utils/http-error.js";

type ReportSource = "appointments" | "patients" | "audit";
type ReportOrientation = "portrait" | "landscape";
type UserRole = "receptionist" | "supervisor" | "super_admin" | "modality_staff" | "doctor";

export interface ReportCenterRenderModel {
  templateId: string;
  source: ReportSource;
  orientation: ReportOrientation;
  title: string;
  dateLabel: string;
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, string>>;
  summaryRows: Array<{ label: string; value: string }>;
}

const APPOINTMENT_TEMPLATES = new Set([
  "daily-appointments", "no-show-list", "cancellation-list", "walk-in-list", "priority-urgent",
  "waiting-list", "appointment-volume-by-modality", "special-quota", "supervisor-override", "exam-type-volume",
]);
const SUPERVISOR_APPOINTMENT_TEMPLATES = new Set(["no-show-list", "cancellation-list", "appointment-volume-by-modality", "special-quota", "supervisor-override", "exam-type-volume"]);
const SOURCE_COLUMNS: Record<ReportSource, Set<string>> = {
  appointments: new Set(["time", "patient", "accession", "modality", "exam", "category", "priority", "status", "phone", "identifier"]),
  patients: new Set(["patient", "identifier", "sex", "age", "phone", "category"]),
  audit: new Set(["time", "user", "action", "report", "rows", "details"]),
};
const SENSITIVE_COLUMNS = new Set(["phone", "identifier"]);
const MAX_ROWS = 500;
const MAX_COLUMNS = 12;
const MAX_CELL_LENGTH = 2_000;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Report render model is invalid.");
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, label: string, max = 300): string {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new HttpError(400, `${label} is invalid.`);
  return value;
}

function assertTemplate(source: ReportSource, templateId: string, role: UserRole): void {
  if (source === "appointments") {
    if (!APPOINTMENT_TEMPLATES.has(templateId)) throw new HttpError(400, "Report template is not printable.");
    if (SUPERVISOR_APPOINTMENT_TEMPLATES.has(templateId) && role !== "supervisor" && role !== "super_admin") throw new HttpError(403, "This role cannot print the selected report.");
    return;
  }
  if (source === "patients" && templateId === "patient-directory") return;
  if (source === "audit" && templateId === "printed-documents-audit" && role === "super_admin") return;
  throw new HttpError(role === "super_admin" ? 400 : 403, "Report template is not printable for this role.");
}

export function parseReportCenterRenderModel(value: unknown, role: UserRole): ReportCenterRenderModel {
  const raw = record(value);
  const source = raw.source;
  if (source !== "appointments" && source !== "patients" && source !== "audit") throw new HttpError(400, "Report source is invalid.");
  const templateId = boundedString(raw.templateId, "Report template", 80);
  assertTemplate(source, templateId, role);
  const orientation = raw.orientation;
  if (orientation !== "portrait" && orientation !== "landscape") throw new HttpError(400, "Report orientation is invalid.");
  const title = boundedString(raw.title, "Report title", 200);
  const dateLabel = boundedString(raw.dateLabel, "Report date label", 200);
  if (!Array.isArray(raw.columns) || raw.columns.length < 1 || raw.columns.length > MAX_COLUMNS) throw new HttpError(400, "Report columns are invalid.");
  const columns = raw.columns.map((item) => {
    const column = record(item);
    const key = boundedString(column.key, "Report column", 40);
    if (!SOURCE_COLUMNS[source].has(key)) throw new HttpError(400, "Report column is not allowed for this source.");
    if (SENSITIVE_COLUMNS.has(key) && role !== "supervisor" && role !== "super_admin") throw new HttpError(403, "Sensitive report columns are not allowed for this role.");
    return { key, label: boundedString(column.label, "Report column label", 80) };
  });
  if (new Set(columns.map((column) => column.key)).size !== columns.length) throw new HttpError(400, "Report columns must be unique.");
  if (!Array.isArray(raw.rows) || raw.rows.length < 1 || raw.rows.length > MAX_ROWS) throw new HttpError(400, "Report rows are invalid.");
  const rows = raw.rows.map((item) => {
    const row = record(item);
    if (Object.keys(row).some((key) => !columns.some((column) => column.key === key))) throw new HttpError(400, "Report row contains an unapproved field.");
    return Object.fromEntries(columns.map(({ key }) => [key, boundedString(row[key] == null ? "" : String(row[key]), "Report cell", MAX_CELL_LENGTH)]));
  });
  const summaryRows = raw.summaryRows == null ? [] : Array.isArray(raw.summaryRows) && raw.summaryRows.length <= 100
    ? raw.summaryRows.map((item) => { const entry = record(item); return { label: boundedString(entry.label, "Summary label", 100), value: boundedString(entry.value, "Summary value", 100) }; })
    : (() => { throw new HttpError(400, "Report summary is invalid."); })();
  return { templateId, source, orientation, title, dateLabel, columns, rows, summaryRows };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function buildReportCenterHtml(model: ReportCenterRenderModel): string {
  const pageSize = model.orientation === "landscape" ? "297mm 210mm" : "210mm 297mm";
  const headings = model.columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("");
  const rows = model.rows.map((row) => `<tr>${model.columns.map((column) => `<td>${escapeHtml(row[column.key] || "")}</td>`).join("")}</tr>`).join("");
  const summaryMaximum = Math.max(1, ...model.summaryRows.map((row) => Number(row.value) || 0));
  const summary = model.summaryRows.length ? `<section class="summary">${model.summaryRows.map((row) => `<div class="summary-row"><strong>${escapeHtml(row.label)}</strong><span class="summary-track"><i style="width:${Math.max(4, ((Number(row.value) || 0) / summaryMaximum) * 100)}%"></i></span><span>${escapeHtml(row.value)}</span></div>`).join("")}</section>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(model.title)}</title><style>
    @page { size: ${pageSize}; margin: 0; } * { box-sizing: border-box; }
    body { margin:0; color:#111827; background:#fff; font-family:Arial,"Noto Naskh Arabic",sans-serif; font-size:9px; }
    .first-header { border-bottom:1px solid #cbd5e1; margin-bottom:4mm; padding-bottom:2mm; }
    h1 { margin:0; font-size:16px; color:#0f766e; } .date { margin:1mm 0 0; color:#475569; }
    .summary { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1.5mm 3mm; margin-bottom:3mm; }
    .summary-row { display:grid; grid-template-columns:28mm 1fr 10mm; align-items:center; gap:2mm; }
    .summary-track { height:2mm; background:#e2e8f0; border-radius:1mm; overflow:hidden; } .summary-track i { display:block; height:100%; background:#0f766e; }
    table { width:100%; border-collapse:collapse; table-layout:fixed; }
    thead { display:table-header-group; } tr { break-inside:avoid; }
    th { background:#0f766e; color:#fff; text-align:left; padding:1.6mm; font-size:8px; }
    td { border-bottom:1px solid #e2e8f0; padding:1.5mm; vertical-align:top; overflow-wrap:anywhere; }
    tbody tr:nth-child(even) { background:#f8fafc; }
  </style></head><body><main data-report-center-document="true"><header class="first-header"><h1>${escapeHtml(model.title)}</h1><p class="date">${escapeHtml(model.dateLabel)} · ${model.rows.length} rows</p></header>${summary}<table><thead><tr>${headings}</tr></thead><tbody>${rows}</tbody></table></main></body></html>`;
}
