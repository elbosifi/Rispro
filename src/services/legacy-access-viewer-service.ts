/**
 * Legacy Access Viewer Service
 *
 * Read-only parser and query layer for the legacy Microsoft Access
 * appointment database (.mdb / .accdb).  Fully isolated from PostgreSQL
 * and the current RISPro workflow.
 *
 * IMPORTANT: This module never writes to the MDB, never writes to PostgreSQL,
 * and never mutates any existing RISPro data.
 *
 * Storage:
 *   The active MDB file is persisted to disk at storage/legacy-viewer/active.mdb
 *   so it survives server restarts.  Only one file is kept at a time.
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import MDBReader from "mdb-reader";
import { HttpError } from "../utils/http-error.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");

const LEGACY_DIR = path.join(rootDir, "storage", "legacy-viewer");
const ACTIVE_FILE = path.join(LEGACY_DIR, "active.mdb");
const META_FILE = path.join(LEGACY_DIR, "meta.json");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LegacyAppointmentRow {
  appointmentId: number | null;
  date: string | null;
  time: string | null;
  patientName: string | null;
  age: number | null;
  sex: string | null;
  modality: string;
  exam: string;
  source: string;
  groupNo: number | null;
}

export interface LegacySummaryCounters {
  todayCount: number;
  tomorrowCount: number;
  weekCount: number;
}

export interface LegacyAppointmentFilters {
  fromDate?: string;
  toDate?: string;
  patientName?: string;
  modality?: string;
  exam?: string;
}

export interface LegacyMdbStatus {
  hasActiveFile: boolean;
  fileName: string | null;
  loadedAt: string | null;
}

export interface LegacyFilterOptions {
  modalities: string[];
  exams: string[];
  sources: string[];
  sexes: string[];
}

interface MetaInfo {
  fileName: string;
  loadedAt: string;
}

// ---------------------------------------------------------------------------
// Sentinel constants
// ---------------------------------------------------------------------------

const SENTINEL_DATE = "9999-12-31";

// ---------------------------------------------------------------------------
// Disk-backed active file state
// ---------------------------------------------------------------------------

/** Ensure the storage directory exists. */
async function ensureDir(): Promise<void> {
  await fs.mkdir(LEGACY_DIR, { recursive: true });
}

/** Read metadata from disk (non-blocking). */
async function readMeta(): Promise<MetaInfo | null> {
  try {
    const raw = await fs.readFile(META_FILE, "utf-8");
    return JSON.parse(raw) as MetaInfo;
  } catch {
    return null;
  }
}

/** Write metadata to disk. */
async function writeMeta(meta: MetaInfo): Promise<void> {
  await fs.writeFile(META_FILE, JSON.stringify(meta, null, 2), "utf-8");
}

/** Check whether the persisted MDB file exists. */
async function hasActiveFileOnDisk(): Promise<boolean> {
  try {
    await fs.access(ACTIVE_FILE);
    return true;
  } catch {
    return false;
  }
}

/** Read the persisted MDB file into a Buffer. */
async function readActiveFile(): Promise<Buffer | null> {
  try {
    return await fs.readFile(ACTIVE_FILE);
  } catch {
    return null;
  }
}

/** Create an MDBReader from either the in-memory buffer or the disk file. */
async function createReader(): Promise<MDBReader | null> {
  // Prefer in-memory if available (from a fresh upload in this process)
  if (inMemoryBuffer) {
    return new MDBReader(inMemoryBuffer);
  }
  // Fall back to disk
  const diskBuffer = await readActiveFile();
  if (diskBuffer) {
    return new MDBReader(diskBuffer);
  }
  return null;
}

// In-memory cache (avoids re-reading disk on every request within one process)
let inMemoryBuffer: Buffer | null = null;
let inMemoryMeta: MetaInfo | null = null;

/**
 * Load in-memory state from disk at startup.
 * Called once when the module is imported.
 */
(async function initFromDisk() {
  try {
    const meta = await readMeta();
    const hasFile = await hasActiveFileOnDisk();
    if (meta && hasFile) {
      inMemoryMeta = meta;
      inMemoryBuffer = await readActiveFile();
    }
  } catch {
    // Silently ignore — no persisted file yet
  }
})();

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

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
 * Convert an OLE Automation date (days since 1899-12-30) to a JS Date.
 */
function oleAutoToDate(oleDate: number): Date {
  const base = new Date(1899, 11, 30);
  const ms = base.getTime() + oleDate * 86400000;
  return new Date(ms);
}

function safeString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function safeNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return isNaN(n) ? null : n;
}

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
    // Table may not exist in this MDB
  }
  return map;
}

function resolveModality(
  row: Record<string, unknown>,
  kindPicMap: Map<unknown, string>
): string {
  const direct = safeString(row["Kname"]);
  if (direct) return direct;
  const fallback = kindPicMap.get(row["kNom"]);
  return fallback ?? "";
}

function resolveExam(
  row: Record<string, unknown>,
  plCheckMap: Map<unknown, string>
): string {
  const direct = safeString(row["PlName"]);
  if (direct) return direct;
  const fallback = plCheckMap.get(row["PlNom"]);
  return fallback ?? "";
}

function resolveSource(
  row: Record<string, unknown>,
  placesMap: Map<unknown, string>
): string {
  const direct = safeString(row["NatNm"]);
  if (direct) return direct;
  const fallback = placesMap.get(row["PNom"]);
  return fallback ?? "";
}

function isTodayOrLater(isoDate: string): boolean {
  const todayStr = new Date().toISOString().slice(0, 10);
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

function getWeekRange(): [string, string] {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun
  const start = new Date(now);
  start.setDate(now.getDate() - dayOfWeek);
  const end = new Date(now);
  end.setDate(now.getDate() + (6 - dayOfWeek));
  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
}

function isInCurrentWeek(isoDate: string): boolean {
  const [weekStart, weekEnd] = getWeekRange();
  const today = new Date().toISOString().slice(0, 10);
  return isoDate >= today && isoDate >= weekStart && isoDate <= weekEnd;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Upload and persist an MDB file.  Replaces any previously stored file.
 */
export async function loadMdbFile(
  base64Content: string,
  fileName: string
): Promise<LegacyMdbStatus> {
  const base64Data = base64Content.includes(",")
    ? base64Content.split(",").pop() ?? ""
    : base64Content;

  const buffer = Buffer.from(base64Data, "base64");

  // Validate
  try {
    const reader = new MDBReader(buffer);
    reader.getTableNames();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new HttpError(400, `الملف المحدد غير صالح: ${msg}`);
  }

  // Persist to disk
  await ensureDir();
  await fs.writeFile(ACTIVE_FILE, buffer);

  const meta: MetaInfo = { fileName, loadedAt: new Date().toISOString() };
  await writeMeta(meta);

  // Update in-memory cache
  inMemoryBuffer = buffer;
  inMemoryMeta = meta;

  return {
    hasActiveFile: true,
    fileName,
    loadedAt: meta.loadedAt
  };
}

/**
 * Get current active file status (from in-memory cache or disk metadata).
 */
export async function getMdbStatus(): Promise<LegacyMdbStatus> {
  if (inMemoryMeta) {
    return {
      hasActiveFile: true,
      fileName: inMemoryMeta.fileName,
      loadedAt: inMemoryMeta.loadedAt
    };
  }
  // Fall back to disk metadata
  const meta = await readMeta();
  if (meta) {
    return {
      hasActiveFile: true,
      fileName: meta.fileName,
      loadedAt: meta.loadedAt
    };
  }
  return { hasActiveFile: false, fileName: null, loadedAt: null };
}

/**
 * Query legacy appointments from the active MDB file.
 */
export async function queryLegacyAppointments(
  filters: LegacyAppointmentFilters = {}
): Promise<LegacyAppointmentRow[]> {
  const reader = await createReader();
  if (!reader) {
    throw new HttpError(400, "لا يوجد ملف MDB نشط");
  }

  const kindPicMap = buildLookupMap(reader, "KindPic", "kpno", "kpnm");
  const plCheckMap = buildLookupMap(reader, "PlCheck", "plNo", "plNm");
  const placesMap = buildLookupMap(reader, "Places", "pno", "pnm");

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
    const dateStr = parseDate(row["DtDate"]);
    if (!dateStr) continue;
    if (!isTodayOrLater(dateStr)) continue;

    if (filters.fromDate && dateStr < filters.fromDate) continue;
    if (filters.toDate && dateStr > filters.toDate) continue;

    const modality = resolveModality(row, kindPicMap);
    const exam = resolveExam(row, plCheckMap);
    const source = resolveSource(row, placesMap);
    const patientName = safeString(row["PationNm"]);

    // Text filters (case-insensitive partial match)
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

  results.sort((a, b) => {
    const dc = (a.date ?? "").localeCompare(b.date ?? "");
    if (dc !== 0) return dc;
    return (a.time ?? "").localeCompare(b.time ?? "");
  });

  return results;
}

/**
 * Compute summary counters from the active MDB file.
 */
export async function computeSummaryCounters(): Promise<LegacySummaryCounters> {
  const reader = await createReader();
  if (!reader) {
    return { todayCount: 0, tomorrowCount: 0, weekCount: 0 };
  }

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

/**
 * Extract distinct, sorted filter option values from the active MDB file.
 * Returns empty arrays if no file is loaded.
 */
export async function getFilterOptions(): Promise<LegacyFilterOptions> {
  const reader = await createReader();
  if (!reader) {
    return { modalities: [], exams: [], sources: [], sexes: [] };
  }

  const kindPicMap = buildLookupMap(reader, "KindPic", "kpno", "kpnm");
  const plCheckMap = buildLookupMap(reader, "PlCheck", "plNo", "plNm");
  const placesMap = buildLookupMap(reader, "Places", "pno", "pnm");

  let pointmentsData: Record<string, unknown>[];
  try {
    const table = reader.getTable("Pointments");
    pointmentsData = table.getData();
  } catch {
    return { modalities: [], exams: [], sources: [], sexes: [] };
  }

  const modalitySet = new Set<string>();
  const examSet = new Set<string>();
  const sourceSet = new Set<string>();
  const sexSet = new Set<string>();

  for (const row of pointmentsData) {
    const dateStr = parseDate(row["DtDate"]);
    if (!dateStr) continue;
    // Only include future appointments (consistent with the query endpoint)
    if (!isTodayOrLater(dateStr)) continue;

    const modality = resolveModality(row, kindPicMap);
    if (modality) modalitySet.add(modality);

    const exam = resolveExam(row, plCheckMap);
    if (exam) examSet.add(exam);

    const source = resolveSource(row, placesMap);
    if (source) sourceSet.add(source);

    const sex = safeString(row["Gnm"]);
    if (sex) sexSet.add(sex);
  }

  return {
    modalities: [...modalitySet].sort((a, b) => a.localeCompare(b, "ar")),
    exams: [...examSet].sort((a, b) => a.localeCompare(b, "ar")),
    sources: [...sourceSet].sort((a, b) => a.localeCompare(b, "ar")),
    sexes: [...sexSet].sort((a, b) => a.localeCompare(b, "ar"))
  };
}
