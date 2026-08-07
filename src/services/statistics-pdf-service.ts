import { HttpError } from "../utils/http-error.js";

export interface StatisticsRenderModel {
  dateFrom: string; dateTo: string; modalityLabel: string;
  summary: Array<{ label: string; value: number }>;
  operational: Array<{ label: string; value: number }>;
  statusBreakdown: Array<{ status: string; count: number }>;
  modalityBreakdown: Array<{ modality: string; total: number; scheduled: number; inQueue: number; completed: number; noShow: number; cancelled: number; discontinued: number }>;
  dailyBreakdown: Array<{ date: string; total: number; completed: number; noShow: number; cancelled: number; discontinued: number }>;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Statistics render model is invalid."); return value as Record<string, unknown>; }
function text(value: unknown, max = 120): string { if (typeof value !== "string" || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new HttpError(400, "Statistics text is invalid."); return value; }
function count(value: unknown): number { if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000_000) throw new HttpError(400, "Statistics value is invalid."); return value; }
function exact(row: Record<string, unknown>, keys: readonly string[]): void { if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key))) throw new HttpError(400, "Statistics row fields are invalid."); }
function rows(value: unknown, max: number): Record<string, unknown>[] { if (!Array.isArray(value) || value.length > max) throw new HttpError(400, "Statistics rows are invalid."); return value.map(object); }

export function parseStatisticsRenderModel(value: unknown): StatisticsRenderModel {
  const raw = object(value);
  exact(raw, ["dateFrom", "dateTo", "modalityLabel", "summary", "operational", "statusBreakdown", "modalityBreakdown", "dailyBreakdown"]);
  const dateFrom = text(raw.dateFrom, 10); const dateTo = text(raw.dateTo, 10);
  if (!DATE.test(dateFrom) || !DATE.test(dateTo) || dateFrom > dateTo) throw new HttpError(400, "Statistics date range is invalid.");
  const metricRows = (value: unknown) => rows(value, 30).map((row) => { exact(row, ["label", "value"]); return { label: text(row.label), value: count(row.value) }; });
  const statusBreakdown = rows(raw.statusBreakdown, 30).map((row) => { exact(row, ["status", "count"]); return { status: text(row.status, 80), count: count(row.count) }; });
  const modalityBreakdown = rows(raw.modalityBreakdown, 100).map((row) => { const keys = ["modality", "total", "scheduled", "inQueue", "completed", "noShow", "cancelled", "discontinued"] as const; exact(row, keys); return { modality: text(row.modality), total: count(row.total), scheduled: count(row.scheduled), inQueue: count(row.inQueue), completed: count(row.completed), noShow: count(row.noShow), cancelled: count(row.cancelled), discontinued: count(row.discontinued) }; });
  const dailyBreakdown = rows(raw.dailyBreakdown, 366).map((row) => { const keys = ["date", "total", "completed", "noShow", "cancelled", "discontinued"] as const; exact(row, keys); const date = text(row.date, 10); if (!DATE.test(date)) throw new HttpError(400, "Statistics date is invalid."); return { date, total: count(row.total), completed: count(row.completed), noShow: count(row.noShow), cancelled: count(row.cancelled), discontinued: count(row.discontinued) }; });
  return { dateFrom, dateTo, modalityLabel: text(raw.modalityLabel), summary: metricRows(raw.summary), operational: metricRows(raw.operational), statusBreakdown, modalityBreakdown, dailyBreakdown };
}

function esc(value: string | number): string { return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;"); }
function metricTable(title: string, data: Array<{ label: string; value: number }>): string { return `<section><h2>${title}</h2><table><tbody>${data.map((row) => `<tr><th>${esc(row.label)}</th><td>${esc(row.value)}</td></tr>`).join("")}</tbody></table></section>`; }
export function buildStatisticsHtml(model: StatisticsRenderModel): string {
  const status = model.statusBreakdown.map((row) => `<tr><td>${esc(row.status)}</td><td>${esc(row.count)}</td></tr>`).join("");
  const modalities = model.modalityBreakdown.map((r) => `<tr><td>${esc(r.modality)}</td><td>${r.total}</td><td>${r.scheduled}</td><td>${r.inQueue}</td><td>${r.completed}</td><td>${r.noShow}</td><td>${r.cancelled}</td><td>${r.discontinued}</td></tr>`).join("");
  const daily = model.dailyBreakdown.map((r) => `<tr><td>${esc(r.date)}</td><td>${r.total}</td><td>${r.completed}</td><td>${r.noShow}</td><td>${r.cancelled}</td><td>${r.discontinued}</td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:297mm 210mm;margin:0}*{box-sizing:border-box}body{margin:0;font:8px Arial,"Noto Naskh Arabic",sans-serif;color:#111827}h1{margin:0 0 1mm;color:#0f766e;font-size:16px}h2{margin:2mm 0 1mm;font-size:10px}.meta{color:#475569}.metrics{display:grid;grid-template-columns:1fr 1fr;gap:4mm}table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}tr{break-inside:avoid}th{background:#0f766e;color:#fff;text-align:left}th,td{padding:1mm;border-bottom:1px solid #e2e8f0;overflow-wrap:anywhere}</style></head><body><main data-statistics-document="true"><h1>RISpro Statistics</h1><div class="meta">${esc(model.dateFrom)} to ${esc(model.dateTo)} · ${esc(model.modalityLabel)}</div><div class="metrics">${metricTable("Summary", model.summary)}${metricTable("Operational", model.operational)}</div><section><h2>Status breakdown</h2><table><tbody>${status}</tbody></table></section><section><h2>Modality breakdown</h2><table><thead><tr><th>Modality</th><th>Total</th><th>Scheduled</th><th>In queue</th><th>Completed</th><th>No show</th><th>Cancelled</th><th>Discontinued</th></tr></thead><tbody>${modalities}</tbody></table></section><section><h2>Daily breakdown</h2><table><thead><tr><th>Date</th><th>Total</th><th>Completed</th><th>No show</th><th>Cancelled</th><th>Discontinued</th></tr></thead><tbody>${daily}</tbody></table></section></main></body></html>`;
}
