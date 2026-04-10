/**
 * Legacy Access Viewer Service
 *
 * Read-only parser and query layer for the legacy Microsoft Access
 * appointment database (.mdb / .accdb).  Fully isolated from PostgreSQL
 * and the current RISPro workflow.
 *
 * IMPORTANT: This module never writes to the MDB, never writes to PostgreSQL,
 * and never mutates any existing RISPro data.
 */

import MDBReader from "mdb-reader";
import { HttpError } from "../utils/http-error.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LegacyAppointmentRow {
  appointmentId: number | null;       // Pointments.Seno
  date: string | null;                // Pointments.DtDate  (ISO date string)
  time: string | null;                // Pointments.DtTime
  patientName: string | null;         // Pointments.PationNm
  age: number | null;                 // Pointments.PationAge
  sex: string | null;                 // Pointments.Gnm
  modality: string;                   // resolved: Kname || KindPic.kpnm || ""
  exam: string;                       // resolved: PlName  || PlCheck.plNm  || ""
  source: string;                     // resolved: NatNm   || Places.pnm    || ""
  groupNo: number | null;             // Pointments.Gno (metadata)
}

export interface LegacySummaryCounters {
  todayCount: number;
  tomorrowCount: number;
  weekCount: number;
}

export interface LegacyAppointmentFilters {
  fromDate?: string;   // ISO date, inclusive
  toDate?: string;     // ISO date, inclusive
  patientName?: string; // partial match
  modality?: string;    // partial match
  exam?: string;        // partial match
}

export interface LegacyMdbStatus {
  hasActiveFile: boolean;
  fileName: string | null;
  loadedAt: string | null; // ISO datetime
}

// ---------------------------------------------------------------------------
// Sentinel / quality constants
// ---------------------------------------------------------------------------

const SENTINEL_DATE = "9999-12-31";

// ---------------------------------------------------------------------------
// In-memory active MDB buffer (one file at a time, process-scoped)
// ---------------------------------------------------------------------------

let activeMdbBuffer: Buffer | null = null;
let activeMdbFileName: string | null = null;
let activeMdbLoadedAt: string | null = null;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function requireActiveReader(): MDBReader {
  if (!activeMdbBuffer) {
    throw new HttpError(400, "لا يوجد ملف MDB نشط"); // "No active MDB file"
  }
  return new MDBReader(activeMdbBuffer);
}

/**
 * Try to parse an Access date value into an ISO date string.
 * Returns null for sentinel, null, or unparseable values.
 */
function parseDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  let d: Date;
  if (value instanceof Date) {
    d = value;
  } else if (typeof value === "number") {
    // Access stores dates as OLE Automation dates (days since 1899-12-30)
    d = oleAutoToDate(value);
  } else if (typeof value === "string") {
    const parsed = new Date(value);
    if (isNaN(parsed.getTime())) return null;
    d = parsed;
  } else {
    return null;
  }

  if (isNaN(d.getTime())) return null;

  const iso = d.toISOString().slice(0, 10);
  if (iso === SENTINEL_DATE) return null;

  return iso;
}

/**
 * Convert an OLE Automation date (number of days since 1899-12-30) to a JS Date.
 */
function oleAutoToDate(oleDate: number): Date {
  const base = new Date(1899, 11, 30); // 1899-12-30
  const ms = base.getTime() + oleDate * 86400000;
  return new Date(ms);
}

/**
 * Safely extract a string value, trimming whitespace.
 */
function safeString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/**
 * Safely extract a numeric value.
 */
function safeNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return isNaN(n) ? null : n;
}

/**
 * Build a lookup map from a table's data.
 * Returns Map<keyValue, displayValue>.
 */
function buildLookupMap(
  reader: MDBReader,
  tableName: string,
  keyCol: string,
  valueCol: string
): Map<unknown, string> {
  const map = new Map<unknown, string>();
  try {
    const table = reader.getTable(tableName);
    const data = table.getData();
    for (const row of data) {
      const key = row[keyCol];
      const val = safeString(row[valueCol]);
      if (val) {
        map.set(key, val);
      }
    }
  } catch {
    // Table may not exist in this MDB – silently skip
  }
  return map;
}

/**
 * Build the combined modality lookup:
 *   primary = Pointments.Kname (already on the row)
 *   fallback = KindPic.kpnm via kNom
 */
function resolveModality(
  row: Record<string, unknown>,
  kindPicMap: Map<unknown, string>
): string {
  const direct = safeString(row["Kname"]);
  if (direct) return direct;
  const fallback = kindPicMap.get(row["kNom"]);
  return fallback ?? "";
}

/**
 * Build the combined exam lookup:
 *   primary = Pointments.PlName
 *   fallback = PlCheck.plNm via PlNom
 */
function resolveExam(
  row: Record<string, unknown>,
  plCheckMap: Map<unknown, string>
): string {
  const direct = safeString(row["PlName"]);
  if (direct) return direct;
  const fallback = plCheckMap.get(row["PlNom"]);
  return fallback ?? "";
}

/**
 * Build the combined source lookup:
 *   primary = Pointments.NatNm
 *   fallback = Places.pnm via PNom
 */
function resolveSource(
  row: Record<string, unknown>,
  placesMap: Map<unknown, string>
): string {
  const direct = safeString(row["NatNm"]);
  if (direct) return direct;
  const fallback = placesMap.get(row["PNom"]);
  return fallback ?? "";
}

/**
 * Check if an ISO date string is >= today (Tripoli/GMT+2).
 * Uses UTC-based comparison for simplicity since we only care about date boundary.
 */
function isTodayOrLater(isoDate: string): boolean {
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  return isoDate >= todayStr;
}

function isToday(isoDate: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return isoDate === today;
}

function isTomorrow(isoDate: string): boolean {
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  return isoDate === tomorrow;
}

/**
 * Get the start-of-week (Sunday) and end-of-week (Saturday) for today.
 * Returns [startISO, endISO] inclusive.
 */
function getWeekRange(): [string, string] {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun ... 6=Sat
  const start = new Date(now);
  start.setDate(now.getDate() - dayOfWeek);
  const end = new Date(now);
  end.setDate(now.getDate() + (6 - dayOfWeek));
  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
}

/**
 * Check if an ISO date is within this week (Sunday-Saturday) AND >= today.
 */
function isInCurrentWeek(isoDate: string): boolean {
  const [weekStart, weekEnd] = getWeekRange();
  const today = new Date().toISOString().slice(0, 10);
  return isoDate >= today && isoDate >= weekStart && isoDate <= weekEnd;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load an MDB file from a base64-encoded payload.
 * The file is stored in memory (process-scoped, one at a time).
 * Returns the MDB file info.
 */
export function loadMdbFile(
  base64Content: string,
  fileName: string
): LegacyMdbStatus {
  // Strip potential data URI prefix
  const base64Data = base64Content.includes(",")
    ? base64Content.split(",").pop() ?? ""
    : base64Content;

  const buffer = Buffer.from(base64Data, "base64");

  // Validate it's a readable MDB by trying to open it
  try {
    const reader = new MDBReader(buffer);
    reader.getTableNames(); // will throw on invalid format
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new HttpError(400, `الملف المحدد غير صالح: ${msg}`);
  }

  activeMdbBuffer = buffer;
  activeMdbFileName = fileName;
  activeMdbLoadedAt = new Date().toISOString();

  return {
    hasActiveFile: true,
    fileName,
    loadedAt: activeMdbLoadedAt
  };
}

/**
 * Get the current active MDB file status.
 */
export function getMdbStatus(): LegacyMdbStatus {
  return {
    hasActiveFile: activeMdbBuffer !== null,
    fileName: activeMdbFileName,
    loadedAt: activeMdbLoadedAt
  };
}

/**
 * Query legacy appointments from the active MDB file.
 * Applies date and text filters.  Only returns appointments from today onward
 * by default (unless explicit from/to dates are provided).
 */
export function queryLegacyAppointments(
  filters: LegacyAppointmentFilters = {}
): LegacyAppointmentRow[] {
  const reader = requireActiveReader();

  // Build lookup maps
  const kindPicMap = buildLookupMap(reader, "KindPic", "kpno", "kpnm");
  const plCheckMap = buildLookupMap(reader, "PlCheck", "plNo", "plNm");
  const placesMap = buildLookupMap(reader, "Places", "pno", "pnm");

  // Read Pointments
  let pointmentsData: Record<string, unknown>[];
  try {
    const table = reader.getTable("Pointments");
    pointmentsData = table.getData();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new HttpError(500, `تعذر قراءة جدول المواعيد: ${msg}`);
  }

  const results: LegacyAppointmentRow[] = [];

  for (const row of pointmentsData) {
    // Parse and validate date
    const dateStr = parseDate(row["DtDate"]);
    if (!dateStr) continue;

    // Default: only today or future
    if (!isTodayOrLater(dateStr)) continue;

    // Apply explicit date range filters
    if (filters.fromDate && dateStr < filters.fromDate) continue;
    if (filters.toDate && dateStr > filters.toDate) continue;

    // Resolve display fields
    const modality = resolveModality(row, kindPicMap);
    const exam = resolveExam(row, plCheckMap);
    const source = resolveSource(row, placesMap);
    const patientName = safeString(row["PationNm"]);

    // Apply text filters
    if (filters.patientName) {
      const q = filters.patientName.toLowerCase();
      if (!patientName.toLowerCase().includes(q)) continue;
    }
    if (filters.modality) {
      const q = filters.modality.toLowerCase();
      if (!modality.toLowerCase().includes(q)) continue;
    }
    if (filters.exam) {
      const q = filters.exam.toLowerCase();
      if (!exam.toLowerCase().includes(q)) continue;
    }

    const timeValue = row["DtTime"];
    let timeStr: string | null = null;
    if (timeValue instanceof Date) {
      // Access time stored as OLE date with fractional day
      const hours = timeValue.getUTCHours().toString().padStart(2, "0");
      const minutes = timeValue.getUTCMinutes().toString().padStart(2, "0");
      timeStr = `${hours}:${minutes}`;
    } else if (typeof timeValue === "number") {
      const d = oleAutoToDate(timeValue);
      const hours = d.getUTCHours().toString().padStart(2, "0");
      const minutes = d.getUTCMinutes().toString().padStart(2, "0");
      timeStr = `${hours}:${minutes}`;
    } else {
      timeStr = safeString(timeValue) || null;
    }

    results.push({
      appointmentId: safeNumber(row["Seno"]),
      date: dateStr,
      time: timeStr,
      patientName: patientName || null,
      age: safeNumber(row["PationAge"]),
      sex: safeString(row["Gnm"]) || null,
      modality,
      exam,
      source,
      groupNo: safeNumber(row["Gno"])
    });
  }

  // Sort: date ASC, then time ASC
  results.sort((a, b) => {
    const dateCompare = (a.date ?? "").localeCompare(b.date ?? "");
    if (dateCompare !== 0) return dateCompare;
    return (a.time ?? "").localeCompare(b.time ?? "");
  });

  return results;
}

/**
 * Compute summary counters from the active MDB file.
 * Counters are computed from the raw future appointments (no text filters).
 */
export function computeSummaryCounters(): LegacySummaryCounters {
  const reader = requireActiveReader();

  let pointmentsData: Record<string, unknown>[];
  try {
    const table = reader.getTable("Pointments");
    pointmentsData = table.getData();
  } catch {
    return { todayCount: 0, tomorrowCount: 0, weekCount: 0 };
  }

  let todayCount = 0;
  let tomorrowCount = 0;
  let weekCount = 0;

  for (const row of pointmentsData) {
    const dateStr = parseDate(row["DtDate"]);
    if (!dateStr) continue;
    if (!isTodayOrLater(dateStr)) continue;

    if (isToday(dateStr)) todayCount++;
    if (isTomorrow(dateStr)) tomorrowCount++;
    if (isInCurrentWeek(dateStr)) weekCount++;
  }

  return { todayCount, tomorrowCount, weekCount };
}
