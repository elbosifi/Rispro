/**
 * Legacy Access Viewer Page — Redesigned
 *
 * Read-only viewer for legacy Microsoft Access appointment databases.
 * Arabic-first, desktop-oriented layout resembling the old workstation form.
 * Fully isolated from PostgreSQL and the current RISPro workflow.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { api } from "@/lib/api-client";
import { normalizeArabic } from "@/lib/arabic-normalize";

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

interface FilterOptions {
  modalities: string[];
  exams: string[];
  sources: string[];
  sexes: string[];
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

async function fetchFilterOptions(): Promise<{ options: FilterOptions }> {
  return api("/legacy-access-viewer/filter-options");
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

/** Print a single appointment slip (current style) */
function printCurrentStyle(row: LegacyAppointmentRow): void {
  const win = window.open("", "_blank");
  if (!win) return;
  const now = new Date().toLocaleString();
  win.document.write(`
    <html dir="rtl">
      <head><meta charset="utf-8"><title>قسيمة موعد</title>
      <style>
        @page { size: A5 portrait; margin: 10mm; }
        * { box-sizing: border-box; }
        body { margin: 0; font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color: #111; background: #fff; }
        .slip { width: 100%; min-height: 100%; border: 2px solid #0f766e; border-radius: 10px; padding: 14px; direction: rtl; text-align: right; }
        .header { text-align: center; padding-bottom: 10px; margin-bottom: 10px; border-bottom: 1px solid #ccc; }
        .brand { margin: 0; font-size: 18px; font-weight: 800; color: #0f766e; }
        .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 10px; font-size: 12px; }
        .field { min-height: 40px; padding: 6px 8px; background: #f5f5f5; border: 1px solid #ddd; border-radius: 6px; }
        .label { display: block; margin-bottom: 2px; font-size: 9px; color: #888; }
        .value { font-size: 12px; font-weight: 700; }
        .footer { margin-top: 12px; padding-top: 8px; border-top: 1px dashed #ccc; display: flex; justify-content: space-between; font-size: 9px; color: #888; }
      </style></head>
      <body>
        <div class="slip">
          <div class="header"><p class="brand">RISpro Reception</p><p style="margin:0;font-size:10px;color:#888">Appointment Slip</p></div>
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
          <div class="footer"><span>Printed by RISpro – Legacy Viewer</span><span>${escapeHtml(now)}</span></div>
        </div>
      </body></html>
  `);
  win.document.close(); win.focus(); win.print();
}

/** Print a single appointment slip (legacy style) */
function printLegacyStyle(row: LegacyAppointmentRow): void {
  const win = window.open("", "_blank");
  if (!win) return;
  const now = new Date().toLocaleString();
  win.document.write(`
    <html dir="rtl">
      <head><meta charset="utf-8"><title>قسيمة موعد - النمط القديم</title>
      <style>
        @page { size: A5 portrait; margin: 10mm; }
        * { box-sizing: border-box; }
        body { margin: 0; font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color: #000; background: #fff; }
        .slip { width: 100%; min-height: 100%; border: 1px solid #333; padding: 12px; direction: rtl; text-align: right; }
        .header { text-align: center; padding-bottom: 8px; margin-bottom: 10px; border-bottom: 2px solid #333; }
        .title { margin: 0; font-size: 16px; font-weight: bold; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        td { padding: 5px 8px; border-bottom: 1px solid #ccc; }
        td.label { width: 28%; font-weight: bold; background: #f0f0f0; }
        .footer { margin-top: 10px; padding-top: 6px; border-top: 1px dashed #999; font-size: 9px; color: #666; text-align: center; }
      </style></head>
      <body>
        <div class="slip">
          <div class="header"><p class="title">منظومة الاستقبال القديمة</p><p style="margin:2px 0 0;font-size:10px;color:#555">Legacy Reception System</p></div>
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
          <div class="footer"><span>طُبع من منظومة RISpro – عارض المنظومة القديمة</span><span> | </span><span>${escapeHtml(now)}</span></div>
        </div>
      </body></html>
  `);
  win.document.close(); win.focus(); win.print();
}

/** Formal A4 appointment list report — filtered by date and modality */
function printFormalList(
  rows: LegacyAppointmentRow[],
  fromDate: string,
  toDate: string,
  modality: string
): void {
  if (rows.length === 0) return;
  const win = window.open("", "_blank");
  if (!win) return;
  const now = new Date().toLocaleString();

  const headerInfo: string[] = [];
  if (fromDate) headerInfo.push(`من: ${formatDisplayDate(fromDate)}`);
  if (toDate) headerInfo.push(`إلى: ${formatDisplayDate(toDate)}`);
  if (modality) headerInfo.push(`نوع الجهاز: ${escapeHtml(modality)}`);

  const trs = rows
    .map(
      (r, i) => `
      <tr>
        <td style="text-align:center">${i + 1}</td>
        <td>${escapeHtml(formatDisplayDate(r.date))}</td>
        <td>${escapeHtml(r.time ?? "—")}</td>
        <td style="direction:rtl;text-align:right">${escapeHtml(r.patientName ?? "—")}</td>
        <td>${r.age ?? "—"}</td>
        <td>${escapeHtml(r.sex ?? "—")}</td>
        <td>${escapeHtml(r.modality || "—")}</td>
        <td>${escapeHtml(r.exam || "—")}</td>
        <td>${escapeHtml(r.source || "—")}</td>
      </tr>`
    )
    .join("");

  win.document.write(`
    <html dir="rtl">
      <head><meta charset="utf-8"><title>تقرير المواعيد</title>
      <style>
        @page { size: A4 landscape; margin: 12mm; }
        @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; color: #000; background: #fff; font-size: 10px; }
        .report { width: 100%; min-height: 100%; direction: rtl; text-align: right; }
        .report-header { text-align: center; border-bottom: 3px double #333; padding-bottom: 8px; margin-bottom: 6px; }
        .report-header h1 { font-size: 18px; margin-bottom: 2px; }
        .report-header h2 { font-size: 12px; font-weight: normal; color: #444; }
        .report-meta { display: flex; justify-content: space-between; font-size: 9px; color: #555; margin-bottom: 6px; padding: 4px 6px; background: #f5f5f5; border: 1px solid #ddd; }
        table { width: 100%; border-collapse: collapse; font-size: 9px; }
        th { background: #e8e8e8; padding: 5px 4px; border: 1px solid #999; text-align: center; font-weight: bold; font-size: 9px; }
        td { padding: 4px 3px; border: 1px solid #ccc; text-align: center; }
        td.name-cell { direction: rtl; text-align: right; }
        tr:nth-child(odd) { background: #fafafa; }
        .footer { margin-top: 8px; padding-top: 6px; border-top: 2px solid #333; display: flex; justify-content: space-between; font-size: 8px; color: #666; }
        .total { text-align: center; margin-top: 6px; font-size: 11px; font-weight: bold; }
      </style></head>
      <body>
        <div class="report">
          <div class="report-header">
            <h1>تقرير المواعيد — منظومة الاستقبال القديمة</h1>
            <h2>Appointment Report — Legacy Reception System</h2>
          </div>
          <div class="report-meta">
            <span>${headerInfo.join(" &nbsp;|&nbsp; ") || "جميع التواريخ"}</span>
            <span>تاريخ الطباعة: ${escapeHtml(now)}</span>
          </div>
          <table>
            <thead><tr>
              <th style="width:28px">#</th>
              <th style="width:60px">التاريخ</th>
              <th style="width:45px">الوقت</th>
              <th>اسم المريض</th>
              <th style="width:30px">العمر</th>
              <th style="width:30px">الجنس</th>
              <th style="width:70px">نوع الجهاز</th>
              <th style="width:90px">نوع الفحص</th>
              <th style="width:80px">الجهة</th>
            </tr></thead>
            <tbody>${trs}</tbody>
          </table>
          <p class="total">العدد الإجمالي: ${rows.length} موعد</p>
          <div class="footer">
            <span>طُبع من نظام RISpro</span>
            <span>صفحة ١</span>
          </div>
        </div>
      </body></html>
  `);
  win.document.close(); win.focus(); win.print();
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
  const [sex, setSex] = useState("");
  const [source, setSource] = useState("");

  // --- Dropdown options from active MDB ---
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    modalities: [], exams: [], sources: [], sexes: []
  });

  // --- Data state ---
  const [appointments, setAppointments] = useState<LegacyAppointmentRow[]>([]);
  const [summary, setSummary] = useState<SummaryCounters>({ todayCount: 0, tomorrowCount: 0, weekCount: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- Mount check ---
  useEffect(() => {
    fetchMdbStatus().then((res) => {
      setMdbStatus(res.status);
      if (res.status.hasActiveFile) {
        // Auto-load options + data when a file is already active
        fetchFilterOptions().then(r => setFilterOptions(r.options)).catch(() => {});
        fetchSummary().then(r => setSummary(r.summary)).catch(() => {});
        fetchLegacyAppointments({}).then(r => setAppointments(r.appointments)).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  // -----------------------------------------------------------------------
  // Callbacks
  // -----------------------------------------------------------------------

  const loadOptionsAndData = useCallback(async () => {
    try {
      const [optsRes, sumRes, aptRes] = await Promise.all([
        fetchFilterOptions(),
        fetchSummary(),
        fetchLegacyAppointments({})
      ]);
      setFilterOptions(optsRes.options);
      setSummary(sumRes.summary);
      setAppointments(aptRes.appointments);
    } catch { /* ignore */ }
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
    setFilterOptions({ modalities: [], exams: [], sources: [], sexes: [] });

    try {
      const base64 = await readFileAsBase64(file);
      const res = await uploadMdbFile(base64, file.name);
      setMdbStatus(res.status);
      await loadOptionsAndData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "تعذر قراءة ملف قاعدة البيانات";
      setUploadError(msg);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [loadOptionsAndData]);

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
      const normPatientName = normalizeArabic(patientName);
      const normModality = normalizeArabic(modality);
      const normExam = normalizeArabic(exam);
      if (normPatientName) params.patientName = normPatientName;
      if (normModality) params.modality = normModality;
      if (normExam) params.exam = normExam;
      const res = await fetchLegacyAppointments(params);
      setAppointments(res.appointments);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "تعذر جلب المواعيد";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [mdbStatus.hasActiveFile, fromDate, toDate, patientName, modality, exam]);

  const handleResetFilters = useCallback(() => {
    setFromDate("");
    setToDate("");
    setPatientName("");
    setModality("");
    setExam("");
    setSex("");
    setSource("");
  }, []);

  const handleRefreshAll = useCallback(async () => {
    if (!mdbStatus.hasActiveFile) return;
    setLoading(true);
    try {
      await loadOptionsAndData();
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, [mdbStatus.hasActiveFile, loadOptionsAndData]);

  const handlePrintList = useCallback(() => {
    printFormalList(appointments, fromDate, toDate, modality);
  }, [appointments, fromDate, toDate, modality]);

  // -----------------------------------------------------------------------
  // Styles (inline for compactness)
  // -----------------------------------------------------------------------

  const sectionStyle: React.CSSProperties = {
    border: "1px solid #c5c5c5",
    borderRadius: 4,
    padding: "6px 10px",
    background: "#fafafa",
    marginBottom: 6
  };
  const sectionTitleStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    color: "#333",
    marginBottom: 4,
    borderBottom: "1px solid #ddd",
    paddingBottom: 2
  };
  const fieldRowStyle: React.CSSProperties = {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: "4px 10px",
    alignItems: "flex-end"
  };
  const fieldStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column" as const,
    gap: 1,
    minWidth: 110,
    flex: "0 0 auto"
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    color: "#555",
    fontWeight: 600
  };
  const inputStyle: React.CSSProperties = {
    fontSize: 11,
    padding: "2px 4px",
    border: "1px solid #bbb",
    borderRadius: 3,
    background: "#fff",
    color: "#222",
    direction: "rtl"
  };
  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    cursor: "pointer"
  };
  const btnPrimaryStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    padding: "3px 14px",
    border: "1px solid #0f766e",
    borderRadius: 3,
    background: "#0f766e",
    color: "#fff",
    cursor: "pointer"
  };
  const btnSecondaryStyle: React.CSSProperties = {
    fontSize: 11,
    padding: "3px 10px",
    border: "1px solid #999",
    borderRadius: 3,
    background: "#eee",
    color: "#333",
    cursor: "pointer"
  };

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div dir="rtl" style={{ fontFamily: "'Segoe UI', Tahoma, Arial, sans-serif", color: "#222", background: "#e8e8e8", minHeight: "100vh", padding: 8 }}>
      {/* Page header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, padding: "4px 10px", background: "#0f766e", color: "#fff", borderRadius: 4 }}>
        <h1 style={{ fontSize: 14, fontWeight: 800, margin: 0 }}>منظومة الاستقبال القديمة</h1>
        <span style={{ fontSize: 10, opacity: 0.85 }}>Legacy Access Viewer</span>
      </div>

      {/* Upload bar (compact when file loaded) */}
      {mdbStatus.hasActiveFile ? (
        <div style={{ ...sectionStyle, display: "flex", justifyContent: "space-between", alignItems: "center", background: "#f0f7f6" }}>
          <span style={{ fontSize: 11, color: "#0f766e" }}>
            الملف النشط: <strong>{mdbStatus.fileName}</strong>
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".mdb,.accdb"
            onChange={handleFileUpload}
            disabled={uploading}
            style={{ fontSize: 10 }}
          />
        </div>
      ) : (
        <div style={{ ...sectionStyle, textAlign: "center", padding: 16 }}>
          <p style={{ fontSize: 12, margin: "0 0 6px", color: "#555" }}>لا يوجد ملف MDB نشط — الرجاء اختيار ملف قاعدة البيانات</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".mdb,.accdb"
            onChange={handleFileUpload}
            disabled={uploading}
            style={{ fontSize: 11 }}
          />
          {uploading && <span style={{ fontSize: 11, color: "#888", marginRight: 8 }}>جاري التحميل...</span>}
          {uploadError && <span style={{ fontSize: 11, color: "#c00", marginRight: 8 }}>{uploadError}</span>}
        </div>
      )}

      {/* Summary strip (compact) */}
      {mdbStatus.hasActiveFile && (
        <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          {[
            { label: "اليوم", value: summary.todayCount, color: "#0f766e" },
            { label: "غدًا", value: summary.tomorrowCount, color: "#d97706" },
            { label: "هذا الأسبوع", value: summary.weekCount, color: "#2563eb" }
          ].map((s) => (
            <div key={s.label} style={{ flex: 1, border: "1px solid #ccc", borderRadius: 3, background: "#fff", padding: "4px 8px", textAlign: "center" }}>
              <span style={{ fontSize: 9, color: "#666" }}>{s.label}</span>
              <span style={{ fontSize: 16, fontWeight: 800, color: s.color, marginRight: 6 }}>{s.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* ---- Filter / work area ---- */}
      {mdbStatus.hasActiveFile && (
        <>
          <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
            {/* Left panel: patient info */}
            <div style={{ flex: 1, ...sectionStyle }}>
              <div style={sectionTitleStyle}>بيانات المريض</div>
              <div style={fieldRowStyle}>
                <div style={{ ...fieldStyle, flex: "1 1 160px" }}>
                  <label style={labelStyle}>اسم المريض</label>
                  <input type="text" value={patientName} onChange={(e) => setPatientName(e.target.value)} placeholder="بحث جزئي..." style={inputStyle} />
                </div>
                <div style={{ ...fieldStyle, flex: "0 0 100px" }}>
                  <label style={labelStyle}>الجنس</label>
                  <select value={sex} onChange={(e) => setSex(e.target.value)} style={selectStyle}>
                    <option value="">الكل</option>
                    {filterOptions.sexes.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div style={{ ...fieldStyle, flex: "0 0 140px" }}>
                  <label style={labelStyle}>من تاريخ</label>
                  <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={inputStyle} />
                </div>
                <div style={{ ...fieldStyle, flex: "0 0 140px" }}>
                  <label style={labelStyle}>إلى تاريخ</label>
                  <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={inputStyle} />
                </div>
              </div>
            </div>

            {/* Right panel: exam info */}
            <div style={{ flex: 1, ...sectionStyle }}>
              <div style={sectionTitleStyle}>بيانات الفحص</div>
              <div style={fieldRowStyle}>
                <div style={{ ...fieldStyle, flex: "0 0 130px" }}>
                  <label style={labelStyle}>نوع الجهاز</label>
                  <select value={modality} onChange={(e) => setModality(e.target.value)} style={selectStyle}>
                    <option value="">الكل</option>
                    {filterOptions.modalities.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div style={{ ...fieldStyle, flex: "0 0 140px" }}>
                  <label style={labelStyle}>نوع الفحص</label>
                  <select value={exam} onChange={(e) => setExam(e.target.value)} style={selectStyle}>
                    <option value="">الكل</option>
                    {filterOptions.exams.map((ex) => <option key={ex} value={ex}>{ex}</option>)}
                  </select>
                </div>
                <div style={{ ...fieldStyle, flex: "0 0 130px" }}>
                  <label style={labelStyle}>الجهة / المصدر</label>
                  <select value={source} onChange={(e) => setSource(e.target.value)} style={selectStyle}>
                    <option value="">الكل</option>
                    {filterOptions.sources.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Action toolbar */}
          <div style={{ display: "flex", gap: 4, marginBottom: 6, padding: "4px 8px", background: "#fff", border: "1px solid #ccc", borderRadius: 3, alignItems: "center" }}>
            <button onClick={handleSearch} disabled={loading} style={btnPrimaryStyle}>
              {loading ? "جاري البحث..." : "بحث"}
            </button>
            <button onClick={handleResetFilters} style={btnSecondaryStyle}>مسح الفلاتر</button>
            <button onClick={handleRefreshAll} style={btnSecondaryStyle}>تحديث</button>
            <div style={{ flex: 1 }} />
            <button onClick={handlePrintList} disabled={appointments.length === 0} style={btnSecondaryStyle}>طباعة القائمة</button>
            {error && <span style={{ fontSize: 11, color: "#c00", marginRight: 8 }}>{error}</span>}
          </div>
        </>
      )}

      {/* ---- Empty state ---- */}
      {!mdbStatus.hasActiveFile && !uploading && (
        <div style={{ textAlign: "center", padding: 40, color: "#999" }}>
          <svg style={{ width: 48, height: 48, margin: "0 auto 8px", opacity: 0.4 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7h16M4 12h16M4 17h10M4 21h6" />
            <rect x="2" y="3" width="20" height="18" rx="2" strokeWidth={2} fill="none" />
          </svg>
          <p style={{ fontSize: 13 }}>لا يوجد ملف MDB نشط</p>
          <p style={{ fontSize: 11 }}>الرجاء اختيار ملف قاعدة البيانات لعرض المواعيد</p>
        </div>
      )}

      {/* ---- Results table ---- */}
      {mdbStatus.hasActiveFile && (
        <div style={{ border: "1px solid #bbb", borderRadius: 3, background: "#fff", overflow: "hidden" }}>
          <div style={{ padding: "3px 8px", background: "#f5f5f5", borderBottom: "1px solid #ddd", fontSize: 10, color: "#666", display: "flex", justifyContent: "space-between" }}>
            <span>النتائج: {appointments.length} موعد</span>
            <span>{loading ? "جاري التحميل..." : ""}</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ background: "#e8e8e8" }}>
                  <th style={{ padding: "3px 4px", border: "1px solid #ccc", textAlign: "center", width: 28 }}>#</th>
                  <th style={{ padding: "3px 4px", border: "1px solid #ccc", textAlign: "center", width: 55 }}>التاريخ</th>
                  <th style={{ padding: "3px 4px", border: "1px solid #ccc", textAlign: "center", width: 40 }}>الوقت</th>
                  <th style={{ padding: "3px 4px", border: "1px solid #ccc", textAlign: "right" }}>اسم المريض</th>
                  <th style={{ padding: "3px 4px", border: "1px solid #ccc", textAlign: "center", width: 28 }}>العمر</th>
                  <th style={{ padding: "3px 4px", border: "1px solid #ccc", textAlign: "center", width: 28 }}>الجنس</th>
                  <th style={{ padding: "3px 4px", border: "1px solid #ccc", textAlign: "center", width: 60 }}>نوع الجهاز</th>
                  <th style={{ padding: "3px 4px", border: "1px solid #ccc", textAlign: "center", width: 70 }}>نوع الفحص</th>
                  <th style={{ padding: "3px 4px", border: "1px solid #ccc", textAlign: "center", width: 70 }}>الجهة</th>
                  <th style={{ padding: "3px 4px", border: "1px solid #ccc", textAlign: "center", width: 50 }}>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {appointments.map((row, idx) => (
                  <tr key={`${row.appointmentId}-${idx}`} style={{ background: idx % 2 === 0 ? "#fff" : "#fafafa" }}>
                    <td style={{ padding: "2px 4px", border: "1px solid #ddd", textAlign: "center" }}>{idx + 1}</td>
                    <td style={{ padding: "2px 4px", border: "1px solid #ddd", textAlign: "center", fontFamily: "monospace", fontSize: 10 }}>{formatDisplayDate(row.date)}</td>
                    <td style={{ padding: "2px 4px", border: "1px solid #ddd", textAlign: "center", fontFamily: "monospace", fontSize: 10 }}>{row.time ?? "—"}</td>
                    <td style={{ padding: "2px 4px", border: "1px solid #ddd", textAlign: "right", direction: "rtl", fontWeight: 600 }}>{row.patientName ?? "—"}</td>
                    <td style={{ padding: "2px 4px", border: "1px solid #ddd", textAlign: "center" }}>{row.age ?? "—"}</td>
                    <td style={{ padding: "2px 4px", border: "1px solid #ddd", textAlign: "center" }}>{row.sex ?? "—"}</td>
                    <td style={{ padding: "2px 4px", border: "1px solid #ddd", textAlign: "center" }}>{row.modality || "—"}</td>
                    <td style={{ padding: "2px 4px", border: "1px solid #ddd", textAlign: "center" }}>{row.exam || "—"}</td>
                    <td style={{ padding: "2px 4px", border: "1px solid #ddd", textAlign: "center" }}>{row.source || "—"}</td>
                    <td style={{ padding: "2px 4px", border: "1px solid #ddd", textAlign: "center" }}>
                      <div style={{ display: "flex", gap: 2, justifyContent: "center" }}>
                        <button onClick={() => printCurrentStyle(row)} style={{ fontSize: 9, padding: "1px 5px", border: "1px solid #0f766e", borderRadius: 2, background: "#0f766e", color: "#fff", cursor: "pointer" }}>طباعة</button>
                        <button onClick={() => printLegacyStyle(row)} style={{ fontSize: 9, padding: "1px 5px", border: "1px solid #999", borderRadius: 2, background: "#eee", color: "#333", cursor: "pointer" }}>قديم</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {appointments.length === 0 && !loading && (
              <div style={{ textAlign: "center", padding: 20, color: "#999", fontSize: 12 }}>لا توجد مواعيد مطابقة</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
