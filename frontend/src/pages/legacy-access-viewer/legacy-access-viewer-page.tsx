/**
 * Legacy Access Viewer Page
 *
 * Read-only viewer for legacy Microsoft Access appointment databases.
 * All user-facing labels are in Arabic.  Fully isolated from PostgreSQL
 * and the current RISPro workflow.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { api } from "@/lib/api-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LegacyAppointmentRow {
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

interface SummaryCounters {
  todayCount: number;
  tomorrowCount: number;
  weekCount: number;
}

interface MdbStatus {
  hasActiveFile: boolean;
  fileName: string | null;
  loadedAt: string | null;
}

// ---------------------------------------------------------------------------
// API helpers (isolated from existing api-hooks.ts)
// ---------------------------------------------------------------------------

async function uploadMdbFile(fileContentBase64: string, fileName: string): Promise<{ status: MdbStatus }> {
  return api("/legacy-access-viewer/upload", {
    method: "POST",
    body: JSON.stringify({ fileContentBase64, fileName })
  }, 120_000); // 2 minutes — MDB files can be large
}

async function fetchMdbStatus(): Promise<{ status: MdbStatus }> {
  return api("/legacy-access-viewer/status");
}

async function fetchLegacyAppointments(params: Record<string, string>): Promise<{ appointments: LegacyAppointmentRow[] }> {
  const qs = new URLSearchParams(params).toString();
  return api(`/legacy-access-viewer/appointments?${qs}`);
}

async function fetchSummary(): Promise<{ summary: SummaryCounters }> {
  return api("/legacy-access-viewer/summary");
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatDisplayDate(isoDate: string | null): string {
  if (!isoDate) return "—";
  // Convert YYYY-MM-DD to DD/MM/YYYY
  const parts = isoDate.split("-");
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

// ---------------------------------------------------------------------------
// Print helpers
// ---------------------------------------------------------------------------

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function printCurrentStyle(row: LegacyAppointmentRow): void {
  const win = window.open("", "_blank");
  if (!win) return;
  const now = new Date().toLocaleString();
  win.document.write(`
    <html>
      <head>
        <title>قسيمة موعد</title>
        <style>
          @page { size: A5 portrait; margin: 10mm; }
          * { box-sizing: border-box; }
          body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #111827; background: #fff; }
          .slip { width: 100%; min-height: 100%; border: 2px solid #0f766e; border-radius: 14px; padding: 16px; direction: rtl; text-align: right; }
          .header { text-align: center; padding-bottom: 12px; margin-bottom: 12px; border-bottom: 1px solid #d1d5db; }
          .brand { margin: 0; font-size: 20px; font-weight: 800; color: #0f766e; }
          .title { margin: 4px 0 0; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.16em; }
          .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 12px; font-size: 12px; }
          .field { min-height: 48px; padding: 8px 10px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; }
          .label { display: block; margin-bottom: 4px; font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.06em; }
          .value { font-size: 13px; font-weight: 700; color: #111827; word-break: break-word; }
          .footer { margin-top: 14px; padding-top: 10px; border-top: 1px dashed #d1d5db; display: flex; justify-content: space-between; gap: 12px; font-size: 10px; color: #6b7280; }
        </style>
      </head>
      <body>
        <div class="slip">
          <div class="header">
            <p class="brand">RISpro Reception</p>
            <p class="title">Appointment Slip</p>
          </div>
          <div class="meta">
            <div class="field"><span class="label">التاريخ</span><span class="value">${escapeHtml(formatDisplayDate(row.date))}</span></div>
            <div class="field"><span class="label">الوقت</span><span class="value">${escapeHtml(row.time ?? "—")}</span></div>
            <div class="field"><span class="label">اسم المريض</span><span class="value">${escapeHtml(row.patientName ?? "—")}</span></div>
            <div class="field"><span class="label">العمر</span><span class="value">${row.age ?? "—"}</span></div>
            <div class="field"><span class="label">الجنس</span><span class="value">${escapeHtml(row.sex ?? "—")}</span></div>
            <div class="field"><span class="label">نوع الجهاز</span><span class="value">${escapeHtml(row.modality || "—")}</span></div>
            <div class="field"><span class="label">نوع الفحص</span><span class="value">${escapeHtml(row.exam || "—")}</span></div>
            <div class="field"><span class="label">الجهة / المصدر</span><span class="value">${escapeHtml(row.source || "—")}</span></div>
          </div>
          <div class="footer">
            <span>Printed by RISpro – Legacy Viewer</span>
            <span>${escapeHtml(now)}</span>
          </div>
        </div>
      </body>
    </html>
  `);
  win.document.close();
  win.focus();
  win.print();
}

function printLegacyStyle(row: LegacyAppointmentRow): void {
  const win = window.open("", "_blank");
  if (!win) return;
  const now = new Date().toLocaleString();
  win.document.write(`
    <html>
      <head>
        <title>قسيمة موعد - النمط القديم</title>
        <style>
          @page { size: A5 portrait; margin: 10mm; }
          * { box-sizing: border-box; }
          body { margin: 0; font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color: #000; background: #fff; }
          .slip { width: 100%; min-height: 100%; border: 1px solid #333; padding: 12px; direction: rtl; text-align: right; }
          .header { text-align: center; padding-bottom: 8px; margin-bottom: 10px; border-bottom: 2px solid #333; }
          .title { margin: 0; font-size: 16px; font-weight: bold; }
          .subtitle { margin: 2px 0 0; font-size: 11px; color: #555; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          td { padding: 6px 8px; border-bottom: 1px solid #ccc; vertical-align: top; }
          td.label { width: 30%; font-weight: bold; background: #f0f0f0; }
          .footer { margin-top: 12px; padding-top: 8px; border-top: 1px dashed #999; font-size: 9px; color: #666; text-align: center; }
        </style>
      </head>
      <body>
        <div class="slip">
          <div class="header">
            <p class="title">منظومة الاستقبال القديمة</p>
            <p class="subtitle">Legacy Reception System – Appointment Slip</p>
          </div>
          <table>
            <tr><td class="label">التاريخ</td><td>${escapeHtml(formatDisplayDate(row.date))}</td></tr>
            <tr><td class="label">الوقت</td><td>${escapeHtml(row.time ?? "—")}</td></tr>
            <tr><td class="label">اسم المريض</td><td>${escapeHtml(row.patientName ?? "—")}</td></tr>
            <tr><td class="label">العمر</td><td>${row.age ?? "—"}</td></tr>
            <tr><td class="label">الجنس</td><td>${escapeHtml(row.sex ?? "—")}</td></tr>
            <tr><td class="label">نوع الجهاز</td><td>${escapeHtml(row.modality || "—")}</td></tr>
            <tr><td class="label">نوع الفحص</td><td>${escapeHtml(row.exam || "—")}</td></tr>
            <tr><td class="label">الجهة / المصدر</td><td>${escapeHtml(row.source || "—")}</td></tr>
            ${row.groupNo != null ? `<tr><td class="label">رقم المجموعة</td><td>${row.groupNo}</td></tr>` : ""}
          </table>
          <div class="footer">
            <span>طُبع من منظومة RISpro – عارض المنظومة القديمة</span>
            <span> | </span>
            <span>${escapeHtml(now)}</span>
          </div>
        </div>
      </body>
    </html>
  `);
  win.document.close();
  win.focus();
  win.print();
}

function printSelectedList(rows: LegacyAppointmentRow[]): void {
  if (rows.length === 0) return;
  const win = window.open("", "_blank");
  if (!win) return;
  const now = new Date().toLocaleString();

  const trs = rows
    .map(
      (r, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(formatDisplayDate(r.date))}</td>
        <td>${escapeHtml(r.time ?? "—")}</td>
        <td>${escapeHtml(r.patientName ?? "—")}</td>
        <td>${r.age ?? "—"}</td>
        <td>${escapeHtml(r.sex ?? "—")}</td>
        <td>${escapeHtml(r.modality || "—")}</td>
        <td>${escapeHtml(r.exam || "—")}</td>
        <td>${escapeHtml(r.source || "—")}</td>
      </tr>`
    )
    .join("");

  win.document.write(`
    <html>
      <head>
        <title>قائمة المواعيد</title>
        <style>
          @page { size: A4 landscape; margin: 8mm; }
          * { box-sizing: border-box; }
          body { margin: 0; font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color: #000; background: #fff; }
          .container { width: 100%; min-height: 100%; border: 1.5px solid #333; padding: 8px; direction: rtl; }
          .header { text-align: center; padding-bottom: 6px; margin-bottom: 6px; border-bottom: 2px solid #333; }
          .title { margin: 0; font-size: 15px; font-weight: bold; }
          table { width: 100%; border-collapse: collapse; font-size: 10px; }
          th { background: #e0e0e0; padding: 5px 4px; border: 1px solid #999; text-align: right; }
          td { padding: 4px; border: 1px solid #ccc; text-align: right; }
          tr:nth-child(odd) { background: #f8f8f8; }
          .footer { margin-top: 6px; padding-top: 6px; border-top: 1px dashed #999; font-size: 8px; color: #666; text-align: center; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <p class="title">قائمة المواعيد – المنظومة القديمة</p>
          </div>
          <table>
            <thead><tr>
              <th>#</th><th>التاريخ</th><th>الوقت</th><th>اسم المريض</th><th>العمر</th><th>الجنس</th><th>نوع الجهاز</th><th>نوع الفحص</th><th>الجهة</th>
            </tr></thead>
            <tbody>${trs}</tbody>
          </table>
          <div class="footer">
            <span>طُبع من RISpro – ${rows.length} موعد</span>
            <span> | </span>
            <span>${escapeHtml(now)}</span>
          </div>
        </div>
      </body>
    </html>
  `);
  win.document.close();
  win.focus();
  win.print();
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

export default function LegacyAccessViewerPage() {
  // --- MDB file state ---
  const [mdbStatus, setMdbStatus] = useState<MdbStatus>({ hasActiveFile: false, fileName: null, loadedAt: null });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // --- Filter state ---
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [patientName, setPatientName] = useState("");
  const [modality, setModality] = useState("");
  const [exam, setExam] = useState("");

  // --- Data state ---
  const [appointments, setAppointments] = useState<LegacyAppointmentRow[]>([]);
  const [summary, setSummary] = useState<SummaryCounters>({ todayCount: 0, tomorrowCount: 0, weekCount: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Selection for print ---
  const [selectedIds, setSelectedIds] = useState<Set<number | null>>(new Set());

  // -----------------------------------------------------------------------
  // Callbacks
  // -----------------------------------------------------------------------

  // --- Check on mount whether an MDB file is already loaded ---
  useEffect(() => {
    fetchMdbStatus().then((res) => setMdbStatus(res.status)).catch(() => {});
  }, []);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".mdb") && !file.name.toLowerCase().endsWith(".accdb")) {
      setUploadError("الملف المحدد غير صالح — يجب أن يكون ملف MDB أو ACCDB");
      return;
    }

    setUploading(true);
    setUploadError(null);
    setAppointments([]);
    setSummary({ todayCount: 0, tomorrowCount: 0, weekCount: 0 });

    try {
      const base64 = await readFileAsBase64(file);
      const res = await uploadMdbFile(base64, file.name);
      setMdbStatus(res.status);

      // Auto-load future appointments after successful upload
      const params: Record<string, string> = {};
      const apptsRes = await fetchLegacyAppointments(params);
      setAppointments(apptsRes.appointments);

      const sumRes = await fetchSummary();
      setSummary(sumRes.summary);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "تعذر قراءة ملف قاعدة البيانات";
      setUploadError(msg);
    } finally {
      setUploading(false);
      // Reset file input so same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, []);

  const handleSearch = useCallback(async () => {
    if (!mdbStatus.hasActiveFile) {
      setError("الرجاء اختيار ملف قاعدة البيانات");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params: Record<string, string> = {};
      if (fromDate) params.fromDate = fromDate;
      if (toDate) params.toDate = toDate;
      if (patientName) params.patientName = patientName;
      if (modality) params.modality = modality;
      if (exam) params.exam = exam;

      const res = await fetchLegacyAppointments(params);
      setAppointments(res.appointments);
      setSelectedIds(new Set());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "تعذر جلب المواعيد";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [mdbStatus.hasActiveFile, fromDate, toDate, patientName, modality, exam]);

  const handleRefreshSummary = useCallback(async () => {
    if (!mdbStatus.hasActiveFile) return;
    try {
      const res = await fetchSummary();
      setSummary(res.summary);
    } catch {
      // ignore
    }
  }, [mdbStatus.hasActiveFile]);

  const handleResetFilters = useCallback(() => {
    setFromDate("");
    setToDate("");
    setPatientName("");
    setModality("");
    setExam("");
  }, []);

  const toggleRowSelection = useCallback((id: number | null) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handlePrintCurrentStyle = useCallback(
    (row: LegacyAppointmentRow) => {
      printCurrentStyle(row);
    },
    []
  );

  const handlePrintLegacyStyle = useCallback(
    (row: LegacyAppointmentRow) => {
      printLegacyStyle(row);
    },
    []
  );

  const handlePrintSelectedList = useCallback(() => {
    const selected = appointments.filter((a) => selectedIds.has(a.appointmentId));
    const toPrint = selected.length > 0 ? selected : appointments;
    printSelectedList(toPrint);
  }, [appointments, selectedIds]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div dir="rtl" className="min-h-screen bg-stone-50 dark:bg-stone-900 text-right">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-teal-700 dark:text-teal-400">
          Malaf منظومة الاستقبال القديمة
        </h1>
        <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">
          عارض المواعيد القديمة من قاعدة بيانات Access — للقراءة فقط
        </p>
      </div>

      {/* --- File Upload Section --- */}
      <section className="mb-6 rounded-2xl border bg-white dark:bg-stone-800 p-5 shadow-sm">
        <h2 className="text-lg font-semibold mb-3 text-stone-800 dark:text-stone-200">
          اختيار ملف قاعدة البيانات
        </h2>

        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".mdb,.accdb"
            onChange={handleFileUpload}
            disabled={uploading}
            className="block text-sm text-stone-600 dark:text-stone-300
              file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0
              file:bg-teal-600 file:text-white file:font-semibold file:cursor-pointer
              hover:file:bg-teal-700 disabled:opacity-50"
          />
          {uploading && (
            <span className="text-sm text-stone-500">جاري التحميل...</span>
          )}
        </div>

        {mdbStatus.hasActiveFile && (
          <div className="mt-3 text-sm text-teal-700 dark:text-teal-400">
            الملف النشط: <strong>{escapeHtml(mdbStatus.fileName ?? "")}</strong>
            {mdbStatus.loadedAt && (
              <span className="mr-2 text-stone-400">
                (تاريخ التحميل: {new Date(mdbStatus.loadedAt).toLocaleString("ar-EG")})
              </span>
            )}
          </div>
        )}

        {uploadError && (
          <div className="mt-3 text-sm text-red-600 dark:text-red-400">
            {uploadError}
          </div>
        )}
      </section>

      {/* --- Summary Counters --- */}
      {mdbStatus.hasActiveFile && (
        <section className="mb-6 grid grid-cols-3 gap-4">
          <div className="rounded-2xl border bg-white dark:bg-stone-800 p-4 text-center shadow-sm">
            <p className="text-sm text-stone-500 dark:text-stone-400">مواعيد اليوم</p>
            <p className="text-3xl font-bold text-teal-700 dark:text-teal-400 mt-1">
              {summary.todayCount}
            </p>
          </div>
          <div className="rounded-2xl border bg-white dark:bg-stone-800 p-4 text-center shadow-sm">
            <p className="text-sm text-stone-500 dark:text-stone-400">مواعيد الغد</p>
            <p className="text-3xl font-bold text-amber-600 dark:text-amber-400 mt-1">
              {summary.tomorrowCount}
            </p>
          </div>
          <div className="rounded-2xl border bg-white dark:bg-stone-800 p-4 text-center shadow-sm">
            <p className="text-sm text-stone-500 dark:text-stone-400">مواعيد هذا الأسبوع</p>
            <p className="text-3xl font-bold text-blue-600 dark:text-blue-400 mt-1">
              {summary.weekCount}
            </p>
          </div>
        </section>
      )}

      {/* --- Filters Section --- */}
      {mdbStatus.hasActiveFile && (
        <section className="mb-6 rounded-2xl border bg-white dark:bg-stone-800 p-5 shadow-sm">
          <h2 className="text-lg font-semibold mb-3 text-stone-800 dark:text-stone-200">
            تصفية البحث
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <label className="block text-xs text-stone-500 dark:text-stone-400 mb-1">من تاريخ</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full rounded-xl border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-700 px-3 py-2 text-sm text-stone-800 dark:text-stone-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-xs text-stone-500 dark:text-stone-400 mb-1">إلى تاريخ</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full rounded-xl border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-700 px-3 py-2 text-sm text-stone-800 dark:text-stone-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-xs text-stone-500 dark:text-stone-400 mb-1">اسم المريض</label>
              <input
                type="text"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                placeholder="بحث جزئي..."
                dir="rtl"
                className="w-full rounded-xl border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-700 px-3 py-2 text-sm text-stone-800 dark:text-stone-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-xs text-stone-500 dark:text-stone-400 mb-1">نوع الجهاز</label>
              <input
                type="text"
                value={modality}
                onChange={(e) => setModality(e.target.value)}
                placeholder="بحث جزئي..."
                dir="rtl"
                className="w-full rounded-xl border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-700 px-3 py-2 text-sm text-stone-800 dark:text-stone-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div>
              <label className="block text-xs text-stone-500 dark:text-stone-400 mb-1">نوع الفحص</label>
              <input
                type="text"
                value={exam}
                onChange={(e) => setExam(e.target.value)}
                placeholder="بحث جزئي..."
                dir="rtl"
                className="w-full rounded-xl border border-stone-300 dark:border-stone-600 bg-white dark:bg-stone-700 px-3 py-2 text-sm text-stone-800 dark:text-stone-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>

          <div className="mt-4 flex gap-2">
            <button
              onClick={handleSearch}
              disabled={loading}
              className="px-6 py-2 rounded-xl bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-50 transition-colors"
            >
              {loading ? "جاري البحث..." : "بحث"}
            </button>
            <button
              onClick={handleResetFilters}
              className="px-4 py-2 rounded-xl border border-stone-300 dark:border-stone-600 text-sm text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors"
            >
              إعادة تعيين
            </button>
            <button
              onClick={handleRefreshSummary}
              className="px-4 py-2 rounded-xl border border-stone-300 dark:border-stone-600 text-sm text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors"
            >
              تحديث العدادات
            </button>
          </div>

          {error && (
            <div className="mt-3 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}
        </section>
      )}

      {/* --- No active file --- */}
      {!mdbStatus.hasActiveFile && !uploading && (
        <div className="text-center py-16 text-stone-400 dark:text-stone-500">
          <svg className="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V9c0-2-1-3-3-3h-3L11 4H7C5 4 4 5 4 7z" />
          </svg>
          <p className="text-lg font-medium">لا يوجد ملف MDB نشط</p>
          <p className="text-sm mt-1">الرجاء اختيار ملف قاعدة البيانات لعرض المواعيد</p>
        </div>
      )}

      {/* --- Results Grid --- */}
      {mdbStatus.hasActiveFile && (
        <section className="rounded-2xl border bg-white dark:bg-stone-800 shadow-sm overflow-hidden">
          {/* Print toolbar */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 dark:border-stone-700">
            <div className="text-sm text-stone-500 dark:text-stone-400">
              {appointments.length > 0
                ? `النتائج: ${appointments.length} موعد`
                : loading
                  ? "جاري التحميل..."
                  : "لا توجد مواعيد مطابقة"}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handlePrintSelectedList}
                disabled={appointments.length === 0}
                className="px-4 py-1.5 rounded-lg border border-stone-300 dark:border-stone-600 text-xs font-medium text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700 disabled:opacity-40 transition-colors"
              >
                طباعة القائمة
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 dark:bg-stone-700/50 text-stone-500 dark:text-stone-400">
                <tr>
                  <th className="text-right p-3 w-10">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === appointments.length && appointments.length > 0}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedIds(new Set(appointments.map((a) => a.appointmentId)));
                        } else {
                          setSelectedIds(new Set());
                        }
                      }}
                      className="rounded border-stone-300"
                    />
                  </th>
                  <th className="text-right p-3">التاريخ</th>
                  <th className="text-right p-3">الوقت</th>
                  <th className="text-right p-3">اسم المريض</th>
                  <th className="text-right p-3">العمر</th>
                  <th className="text-right p-3">الجنس</th>
                  <th className="text-right p-3">نوع الجهاز</th>
                  <th className="text-right p-3">نوع الفحص</th>
                  <th className="text-right p-3">الجهة / المصدر</th>
                  <th className="text-right p-3">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200 dark:divide-stone-700">
                {appointments.map((row, idx) => (
                  <tr
                    key={`${row.appointmentId}-${idx}`}
                    className={`hover:bg-stone-50 dark:hover:bg-stone-700/50 transition-colors ${
                      selectedIds.has(row.appointmentId) ? "bg-teal-50 dark:bg-teal-900/20" : ""
                    }`}
                  >
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(row.appointmentId)}
                        onChange={() => toggleRowSelection(row.appointmentId)}
                        className="rounded border-stone-300"
                      />
                    </td>
                    <td className="p-3 font-mono text-xs">{formatDisplayDate(row.date)}</td>
                    <td className="p-3 font-mono text-xs">{row.time ?? "—"}</td>
                    <td className="p-3 font-semibold" dir="rtl">{row.patientName ?? "—"}</td>
                    <td className="p-3">{row.age ?? "—"}</td>
                    <td className="p-3">{row.sex ?? "—"}</td>
                    <td className="p-3">{row.modality || "—"}</td>
                    <td className="p-3">{row.exam || "—"}</td>
                    <td className="p-3">{row.source || "—"}</td>
                    <td className="p-3">
                      <div className="flex gap-1">
                        <button
                          onClick={() => handlePrintCurrentStyle(row)}
                          title="طباعة بالنمط الحالي"
                          className="px-2 py-1 rounded-md text-[10px] bg-teal-600 text-white hover:bg-teal-700 transition-colors"
                        >
                          طباعة
                        </button>
                        <button
                          onClick={() => handlePrintLegacyStyle(row)}
                          title="طباعة بالنمط القديم"
                          className="px-2 py-1 rounded-md text-[10px] border border-stone-300 dark:border-stone-600 text-stone-600 dark:text-stone-300 hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors"
                        >
                          قديم
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Empty state */}
          {appointments.length === 0 && !loading && (
            <div className="text-center py-12 text-stone-400 dark:text-stone-500">
              لا توجد مواعيد مطابقة
            </div>
          )}
        </section>
      )}
    </div>
  );
}
