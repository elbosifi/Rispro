import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Download, FileSpreadsheet, FileText, Printer } from "lucide-react";
import { DateInput } from "@/components/common/date-input";
import { Button, Card, Badge } from "@/components/shared";
import { exportReportXlsx, fetchAppointments, fetchAppointmentLookups, fetchAuditEntries, fetchPatientDirectory, recordReportOutput, type PatientDirectoryParams } from "@/lib/api-hooks";
import type { AppointmentWithDetails } from "@/lib/mappers";
import type { AuditEntry } from "@/types/api";
import { formatDateLy, todayIsoDateLy } from "@/lib/date-format";
import { chooseLocalized, statusLabel } from "@/lib/i18n";
import { useAuth } from "@/providers/auth-provider";
import { useLanguage } from "@/providers/language-provider";
import { pushToast } from "@/lib/toast";
import { directPrintReportCenter, fetchReportCenterPdf } from "@/services/printing/direct-print-service";
import { resolveDirectPrintFailureAction } from "@/services/printing/direct-print-failure-action";
import { loadQzPrinterSettings } from "@/services/printing/workstation-printer-settings";
import type { ReportCenterRenderModel } from "@/types/printing";
import { REPORT_TEMPLATES } from "./report-center-templates";

const APPOINTMENT_COLUMNS = ["time", "patient", "accession", "modality", "exam", "category", "priority", "status", "phone", "identifier"];
const PRESETS_KEY = "rispro-print-report-presets";

interface ReportPreset {
  name: string;
  templateId: string;
  date: string;
  dateTo: string;
  modalityId: string;
  status: string;
  caseCategory: string;
  query: string;
  groupBy: string;
  orientation: "portrait" | "landscape";
  paperSize: string;
  includeCharts: boolean;
  includePhones: boolean;
  includeIdentifiers: boolean;
  columns: string[];
}

export function ReportCenter() {
  const { user } = useAuth();
  const { language } = useLanguage();
  const [templateId, setTemplateId] = useState("daily-appointments");
  const [date, setDate] = useState(todayIsoDateLy());
  const [dateTo, setDateTo] = useState("");
  const [modalityId, setModalityId] = useState("");
  const [status, setStatus] = useState("");
  const [caseCategory, setCaseCategory] = useState("");
  const [query, setQuery] = useState("");
  const [groupBy, setGroupBy] = useState("");
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("landscape");
  const [paperSize, setPaperSize] = useState("A4");
  const [includeCharts, setIncludeCharts] = useState(true);
  const [includePhones, setIncludePhones] = useState(false);
  const [includeIdentifiers, setIncludeIdentifiers] = useState(user?.role === "supervisor" || user?.role === "super_admin");
  const [columns, setColumns] = useState<string[]>(APPOINTMENT_COLUMNS.slice(0, 8));
  const [presetName, setPresetName] = useState("");
  const [presets, setPresets] = useState<ReportPreset[]>(() => loadPresets());

  const templates = useMemo(
    () => REPORT_TEMPLATES.filter((template) => user && template.roles.includes(user.role)),
    [user]
  );
  const selectedTemplate = templates.find((template) => template.id === templateId) ?? templates[0] ?? REPORT_TEMPLATES[0];

  const { data: lookups } = useQuery({
    queryKey: ["lookups"],
    queryFn: fetchAppointmentLookups,
    staleTime: 1000 * 60 * 5,
  });

  const appointmentParams = useMemo(() => {
    const params: Record<string, string> = {
      dateFrom: date,
      dateTo: dateTo || date,
      sort: "time-asc",
    };
    if (modalityId) params.modalityId = modalityId;
    if (status || selectedTemplate.status) params.status = status || selectedTemplate.status || "";
    if (caseCategory) params.caseCategory = caseCategory;
    if (query) params.q = query;
    if (selectedTemplate.walkIn) params.walkIn = selectedTemplate.walkIn;
    if (selectedTemplate.specialQuota) params.specialQuota = selectedTemplate.specialQuota;
    if (selectedTemplate.supervisorOverride) params.supervisorOverride = selectedTemplate.supervisorOverride;
    return params;
  }, [caseCategory, date, dateTo, modalityId, query, selectedTemplate, status]);

  const patientParams = useMemo<PatientDirectoryParams>(() => ({
    q: query || undefined,
    category: caseCategory === "oncology" || caseCategory === "non_oncology" ? caseCategory : undefined,
    page: 1,
    pageSize: 100,
  }), [caseCategory, query]);

  const appointmentsQuery = useQuery({
    queryKey: ["report-center-appointments", selectedTemplate.id, appointmentParams],
    queryFn: () => fetchAppointments(appointmentParams),
    enabled: selectedTemplate.source === "appointments",
    staleTime: 1000 * 30,
  });

  const patientsQuery = useQuery({
    queryKey: ["report-center-patients", selectedTemplate.id, patientParams],
    queryFn: () => fetchPatientDirectory(patientParams),
    enabled: selectedTemplate.source === "patients",
    staleTime: 1000 * 30,
  });
  const auditQuery = useQuery({
    queryKey: ["report-center-audit", selectedTemplate.id],
    queryFn: () => fetchAuditEntries(200),
    enabled: selectedTemplate.source === "audit",
    staleTime: 1000 * 30,
  });

  const appointmentRows = appointmentsQuery.data ?? [];
  const patientRows = patientsQuery.data?.patients ?? [];
  const auditRows = (auditQuery.data?.entries ?? []).filter((entry) => entry.entityType === "report_output");
  const activeRows = selectedTemplate.source === "patients" ? patientRows : selectedTemplate.source === "audit" ? auditRows : appointmentRows;
  const isLoading = selectedTemplate.source === "patients" ? patientsQuery.isLoading : selectedTemplate.source === "audit" ? auditQuery.isLoading : appointmentsQuery.isLoading;
  const isError = selectedTemplate.source === "patients" ? patientsQuery.isError : selectedTemplate.source === "audit" ? auditQuery.isError : appointmentsQuery.isError;
  const grouping = groupBy || selectedTemplate.grouping || "";
  const groupedCounts = selectedTemplate.source === "appointments" ? buildGroupedCounts(appointmentRows, grouping, language) : [];
  const sensitiveOutputAllowed = user?.role === "supervisor" || user?.role === "super_admin";
  const effectiveIncludePhones = sensitiveOutputAllowed && includePhones;
  const effectiveIncludeIdentifiers = sensitiveOutputAllowed && includeIdentifiers;

  const exportRows = selectedTemplate.source === "audit"
    ? auditRows.map((entry) => auditExportRow(entry))
    : selectedTemplate.source === "patients"
    ? patientRows.map((patient) => ({
      Patient: patient.englishFullName || patient.arabicFullName,
      MRN: effectiveIncludeIdentifiers ? patient.mrn || "" : "",
      Sex: patient.sex || "",
      Age: patient.ageYears,
      Phone: effectiveIncludePhones ? patient.phone1 || "" : "",
      Category: patient.category || "",
    }))
    : appointmentRows.map((appointment) => appointmentExportRow(appointment, language, effectiveIncludePhones, effectiveIncludeIdentifiers));

  async function auditOutput(outputType: "print" | "pdf" | "csv" | "copy" | "xlsx") {
    try {
      await recordReportOutput({
        reportTemplate: selectedTemplate.id,
        outputType,
        filters: selectedTemplate.source === "patients" ? { ...patientParams } : appointmentParams,
        rowCount: activeRows.length,
        includePhoneNumbers: effectiveIncludePhones,
        includePatientIdentifiers: effectiveIncludeIdentifiers,
      });
      return true;
    } catch (error) {
      pushToast({
        type: "error",
        title: "Output blocked",
        message: error instanceof Error ? error.message : "Could not write the required audit log.",
      });
      return false;
    }
  }

  async function exportCsv() {
    if (!(await auditOutput("csv"))) return;
    downloadText(`${selectedTemplate.id}-${date}.csv`, toCsv(exportRows));
  }

  async function copyTable() {
    if (!(await auditOutput("copy"))) return;
    const text = toCsv(exportRows);
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).then(() => pushToast({ type: "success", title: "Table copied", message: "Report rows were copied to the clipboard." }));
    }
  }

  async function printReport() {
    if (!(await auditOutput("print"))) return;
    const model = buildRenderModel();
    if (!model) return;
    const result = await directPrintReportCenter(model);
    if (result.success) {
      pushToast({ type: "success", title: "Print job submitted", message: `Print job sent to ${result.printerName}.` });
      return;
    }
    const action = resolveDirectPrintFailureAction(result.errorCode, true, loadQzPrinterSettings().browserPrintFallbackEnabled);
    const toastAction = action === "OPEN_SETTINGS"
      ? { label: "Open Printing settings", onClick: () => window.location.assign("/workstation/printing") }
      : action === "BROWSER_PRINT"
        ? { label: "Use browser printing", onClick: () => void browserPrintReport(model) }
        : null;
    pushToast({ type: "error", title: "Print failed", message: result.message, ...(toastAction ? { action: toastAction } : {}) }, 10_000);
  }

  async function printPdf() {
    if (!(await auditOutput("pdf"))) return;
    const model = buildRenderModel();
    if (!model) return;
    try {
      downloadPdf(await fetchReportCenterPdf(model), `${selectedTemplate.id}-${date}.pdf`);
    } catch (error) {
      pushToast({ type: "error", title: "PDF generation failed", message: error instanceof Error ? error.message : "The report PDF could not be generated." });
    }
  }

  function buildRenderModel(): ReportCenterRenderModel | null {
    if (selectedTemplate.source === "disabled") return null;
    const dateLabel = dateTo ? `${date} to ${dateTo}` : date;
    const summaryRows = includeCharts ? groupedCounts.map((row) => ({ label: row.label, value: String(row.count) })) : [];
    if (selectedTemplate.source === "appointments") {
      const outputColumns = columns.filter((column) => (column !== "phone" || effectiveIncludePhones) && (column !== "identifier" || effectiveIncludeIdentifiers));
      return {
        templateId: selectedTemplate.id, source: "appointments", orientation, title: selectedTemplate.title, dateLabel,
        columns: outputColumns.map((key) => ({ key, label: key })),
        rows: appointmentRows.map((row) => Object.fromEntries(outputColumns.map((key) => [key, String(appointmentCell(row, key, language, effectiveIncludePhones, effectiveIncludeIdentifiers) ?? "")]))),
        summaryRows,
      };
    }
    if (selectedTemplate.source === "patients") {
      const reportColumns = [
        { key: "patient", label: "Patient" },
        ...(effectiveIncludeIdentifiers ? [{ key: "identifier", label: "MRN" }] : []),
        { key: "sex", label: "Sex" }, { key: "age", label: "Age" },
        ...(effectiveIncludePhones ? [{ key: "phone", label: "Phone" }] : []),
        { key: "category", label: "Category" },
      ];
      return {
        templateId: selectedTemplate.id, source: "patients", orientation, title: selectedTemplate.title, dateLabel,
        columns: reportColumns,
        rows: patientRows.map((row) => {
          const values: Record<string, string> = { patient: row.englishFullName || row.arabicFullName, identifier: row.mrn || "", sex: row.sex || "", age: String(row.ageYears ?? ""), phone: row.phone1 || "", category: row.category || "" };
          return Object.fromEntries(reportColumns.map(({ key }) => [key, values[key] || ""]));
        }),
        summaryRows: [],
      };
    }
    return {
      templateId: selectedTemplate.id, source: "audit", orientation, title: selectedTemplate.title, dateLabel,
      columns: [{ key: "time", label: "Time" }, { key: "user", label: "User" }, { key: "action", label: "Output" }, { key: "report", label: "Template" }, { key: "rows", label: "Rows" }, { key: "details", label: "Sensitive fields" }],
      rows: auditRows.map((row) => {
        const values = asRecord(row.newValues);
        return { time: row.createdAt || "", user: String(row.changedByUserId ?? ""), action: String(values.outputType || row.actionType || ""), report: String(values.reportTemplate || ""), rows: String(values.rowCount ?? ""), details: `${values.includePhoneNumbers ? "phones " : ""}${values.includePatientIdentifiers ? "identifiers" : ""}`.trim() || "none" };
      }),
      summaryRows: [],
    };
  }

  async function exportExcel() {
    try {
      await exportReportXlsx({
        reportTemplate: selectedTemplate.id,
        filters: asRecord(selectedTemplate.source === "patients" ? patientParams : appointmentParams),
        rows: exportRows,
        includePhoneNumbers: effectiveIncludePhones,
        includePatientIdentifiers: effectiveIncludeIdentifiers,
      });
    } catch (error) {
      pushToast({
        type: "error",
        title: "Excel export failed",
        message: error instanceof Error ? error.message : "Could not generate the workbook.",
      });
    }
  }

  function savePreset() {
    const name = presetName.trim();
    if (!name) return;
    const nextPreset: ReportPreset = {
      name,
      templateId: selectedTemplate.id,
      date,
      dateTo,
      modalityId,
      status,
      caseCategory,
      query,
      groupBy,
      orientation,
      paperSize,
      includeCharts,
      includePhones,
      includeIdentifiers,
      columns,
    };
    const next = [nextPreset, ...presets.filter((preset) => preset.name !== name)].slice(0, 12);
    setPresets(next);
    localStorage.setItem(PRESETS_KEY, JSON.stringify(next));
    pushToast({ type: "success", title: "Preset saved", message: `${name} is ready to reuse.` });
  }

  function loadPreset(name: string) {
    const preset = presets.find((item) => item.name === name);
    if (!preset) return;
    setTemplateId(preset.templateId);
    setDate(preset.date);
    setDateTo(preset.dateTo);
    setModalityId(preset.modalityId);
    setStatus(preset.status);
    setCaseCategory(preset.caseCategory);
    setQuery(preset.query);
    setGroupBy(preset.groupBy);
    setOrientation(preset.orientation);
    setPaperSize("A4");
    setIncludeCharts(preset.includeCharts);
    setIncludePhones(preset.includePhones);
    setIncludeIdentifiers(preset.includeIdentifiers);
    setColumns(preset.columns);
  }

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      <div className="flex flex-col gap-2 lg:hidden">
        <h2 className="text-2xl font-bold">Print & Reports Center</h2>
        <p className="text-sm text-muted-foreground">Templates, filters, preview, and exports.</p>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[320px_1fr]">
        <Card className="p-4 space-y-4">
          <div>
            <p className="text-xs font-mono uppercase tracking-[0.15em] text-muted-foreground">Report template</p>
            <select className="input-premium mt-2 w-full" value={selectedTemplate.id} onChange={(event) => setTemplateId(event.target.value)}>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>{template.title}</option>
              ))}
            </select>
            <p className="mt-2 text-sm text-muted-foreground">{selectedTemplate.description}</p>
            {selectedTemplate.disabledReason ? <p className="mt-2 text-xs text-amber-700">{selectedTemplate.disabledReason}</p> : null}
          </div>

          <div className="grid gap-2">
            <Input label="Preset name" value={presetName} onChange={setPresetName} />
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={savePreset} disabled={!presetName.trim()}>
                Save preset
              </Button>
              <select className="input-premium h-10 flex-1" aria-label="Load preset" defaultValue="" onChange={(event) => loadPreset(event.target.value)}>
                <option value="">Load preset</option>
                {presets.map((preset) => <option key={preset.name} value={preset.name}>{preset.name}</option>)}
              </select>
            </div>
          </div>

          <div className="grid gap-3">
            <DateInput label="Date from" value={date} onChange={setDate} />
            <DateInput label="Date to" value={dateTo} onChange={setDateTo} />
            <Select label="Modality" value={modalityId} onChange={setModalityId} options={[{ value: "", label: "All modalities" }, ...(lookups?.modalities ?? []).map((modality) => ({ value: String(modality.id), label: modality.nameEn }))]} />
            <Select label="Status" value={status} onChange={setStatus} options={[
              { value: "", label: selectedTemplate.status ? `Template default (${selectedTemplate.status})` : "Active statuses" },
              ...["scheduled", "arrived", "waiting", "in-progress", "completed", "no-show", "cancelled", "discontinued"].map((value) => ({ value, label: value })),
            ]} />
            <Select label="Patient category" value={caseCategory} onChange={setCaseCategory} options={[
              { value: "", label: "All categories" },
              { value: "oncology", label: "Oncology" },
              { value: "non_oncology", label: "General / non-oncology" },
            ]} />
            <Input label="Patient, MRN, ID, accession" value={query} onChange={setQuery} />
            <Select label="Grouping" value={groupBy} onChange={setGroupBy} options={[
              { value: "", label: selectedTemplate.grouping ? `Template default (${selectedTemplate.grouping})` : "None" },
              { value: "modality", label: "Modality" },
              { value: "status", label: "Status" },
              { value: "category", label: "Patient category" },
            ]} />
          </div>
        </Card>

        <div className="space-y-5">
          <Card className="p-4 space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-2xl font-bold">Print & Reports Center</h2>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <Badge variant="info">{activeRows.length} rows</Badge>
                  <Badge variant={selectedTemplate.source === "disabled" ? "warning" : "success"}>{selectedTemplate.source}</Badge>
                  <Badge variant="neutral">{paperSize} {orientation}</Badge>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={() => void printReport()} disabled={activeRows.length === 0 || selectedTemplate.source === "disabled"}>
                  <Printer size={15} /> Print
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => void printPdf()} disabled={activeRows.length === 0 || selectedTemplate.source === "disabled"}>
                  <FileText size={15} /> Download PDF
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => void exportExcel()} disabled={activeRows.length === 0}>
                  <FileSpreadsheet size={15} /> Excel
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => void exportCsv()} disabled={activeRows.length === 0}>
                  <Download size={15} /> CSV
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => void copyTable()} disabled={activeRows.length === 0}>
                  <Copy size={15} /> Copy
                </Button>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Select label="Paper" value={paperSize} onChange={setPaperSize} options={[{ value: "A4", label: "A4" }]} />
              <Select label="Orientation" value={orientation} onChange={(value) => setOrientation(value as "portrait" | "landscape")} options={[{ value: "landscape", label: "Landscape" }, { value: "portrait", label: "Portrait" }]} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeCharts} onChange={(event) => setIncludeCharts(event.target.checked)} /> Charts</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includePhones} disabled={!sensitiveOutputAllowed} onChange={(event) => setIncludePhones(event.target.checked)} /> Patient phones</label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={includeIdentifiers} disabled={!sensitiveOutputAllowed} onChange={(event) => setIncludeIdentifiers(event.target.checked)} />
                Patient identifiers
              </label>
            </div>

            {selectedTemplate.source === "appointments" ? (
              <div>
                <p className="mb-2 text-xs font-mono uppercase tracking-[0.15em] text-muted-foreground">Columns</p>
                <div className="flex flex-wrap gap-2">
                  {APPOINTMENT_COLUMNS.map((column) => (
                    <label key={column} className="rounded-lg border border-border px-2 py-1 text-xs">
                      <input
                        type="checkbox"
                        className="mr-1"
                        checked={columns.includes(column)}
                        onChange={(event) => setColumns((current) => event.target.checked ? [...current, column] : current.filter((item) => item !== column))}
                      />
                      {column}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
          </Card>

          {includeCharts && groupedCounts.length > 0 ? <MiniChart rows={groupedCounts} /> : null}

          <Card className="overflow-hidden">
            <div className="border-b border-border p-4">
              <h3 className="font-semibold">Live preview</h3>
            </div>
            {selectedTemplate.source === "disabled" ? (
              <div className="p-8 text-center text-muted-foreground">{selectedTemplate.disabledReason}</div>
            ) : isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Loading report preview...</div>
            ) : isError ? (
              <div className="p-8 text-center text-rose-700">Could not load report preview.</div>
            ) : activeRows.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">No rows match these filters.</div>
            ) : selectedTemplate.source === "audit" ? (
              <AuditPreview rows={auditRows} />
            ) : selectedTemplate.source === "patients" ? (
              <PatientPreview rows={patientRows} includePhones={effectiveIncludePhones} includeIdentifiers={effectiveIncludeIdentifiers} />
            ) : (
              <AppointmentPreview rows={appointmentRows} columns={columns} language={language} includePhones={effectiveIncludePhones} includeIdentifiers={effectiveIncludeIdentifiers} />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <label className="block">
      <span className="text-xs font-mono uppercase tracking-[0.15em] text-muted-foreground">{label}</span>
      <select className="input-premium mt-1 w-full" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs font-mono uppercase tracking-[0.15em] text-muted-foreground">{label}</span>
      <input className="input-premium input-ltr mt-1 w-full" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function AppointmentPreview({ rows, columns, language, includePhones, includeIdentifiers }: { rows: AppointmentWithDetails[]; columns: string[]; language: "ar" | "en"; includePhones: boolean; includeIdentifiers: boolean }) {
  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[860px] text-sm">
        <thead className="bg-muted/50 text-xs uppercase tracking-[0.12em] text-muted-foreground">
          <tr>{columns.map((column) => <th key={column} className="px-3 py-2 text-left">{column}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.slice(0, 100).map((row) => (
            <tr key={row.id}>
              {columns.map((column) => <td key={column} className="px-3 py-2">{appointmentCell(row, column, language, includePhones, includeIdentifiers)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PatientPreview({ rows, includePhones, includeIdentifiers }: { rows: Awaited<ReturnType<typeof fetchPatientDirectory>>["patients"]; includePhones: boolean; includeIdentifiers: boolean }) {
  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-muted/50 text-xs uppercase tracking-[0.12em] text-muted-foreground">
          <tr><th className="px-3 py-2 text-left">Patient</th><th className="px-3 py-2 text-left">MRN</th><th className="px-3 py-2 text-left">Age/Sex</th><th className="px-3 py-2 text-left">Phone</th><th className="px-3 py-2 text-left">Category</th></tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="px-3 py-2">{row.englishFullName || row.arabicFullName}</td>
              <td className="px-3 py-2">{includeIdentifiers ? row.mrn || "-" : "Restricted"}</td>
              <td className="px-3 py-2">{row.ageYears || "-"} / {row.sex || "-"}</td>
              <td className="px-3 py-2">{includePhones ? row.phone1 || "-" : "Hidden"}</td>
              <td className="px-3 py-2">{row.category || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditPreview({ rows }: { rows: AuditEntry[] }) {
  return (
    <div className="overflow-auto">
      <table className="w-full min-w-[780px] text-sm">
        <thead className="bg-muted/50 text-xs uppercase tracking-[0.12em] text-muted-foreground">
          <tr><th className="px-3 py-2 text-left">Time</th><th className="px-3 py-2 text-left">Output</th><th className="px-3 py-2 text-left">Template</th><th className="px-3 py-2 text-left">Rows</th><th className="px-3 py-2 text-left">Sensitive fields</th></tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => {
            const values = asRecord(row.newValues);
            return (
              <tr key={row.id}>
                <td className="px-3 py-2">{row.createdAt || "-"}</td>
                <td className="px-3 py-2">{String(values.outputType || row.actionType || "-")}</td>
                <td className="px-3 py-2">{String(values.reportTemplate || "-")}</td>
                <td className="px-3 py-2">{String(values.rowCount ?? "-")}</td>
                <td className="px-3 py-2">
                  {values.includePhoneNumbers ? "phones " : ""}
                  {values.includePatientIdentifiers ? "identifiers" : ""}
                  {!values.includePhoneNumbers && !values.includePatientIdentifiers ? "none" : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MiniChart({ rows }: { rows: Array<{ label: string; count: number }> }) {
  const max = Math.max(...rows.map((row) => row.count), 1);
  return (
    <Card className="p-4">
      <h3 className="mb-3 font-semibold">Charts</h3>
      <div className="space-y-2">
        {rows.slice(0, 10).map((row) => (
          <div key={row.label} className="grid grid-cols-[160px_1fr_48px] items-center gap-3 text-sm">
            <span className="truncate">{row.label}</span>
            <div className="h-3 rounded bg-muted"><div className="h-3 rounded bg-accent" style={{ width: `${Math.max(4, (row.count / max) * 100)}%` }} /></div>
            <span className="text-right font-mono">{row.count}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function appointmentCell(row: AppointmentWithDetails, column: string, language: "ar" | "en", includePhones: boolean, includeIdentifiers: boolean) {
  switch (column) {
    case "time": return row.bookingTime || "-";
    case "patient": return chooseLocalized(language, row.arabicFullName, row.englishFullName);
    case "accession": return row.accessionNumber;
    case "modality": return chooseLocalized(language, row.modalityNameAr, row.modalityNameEn) || "-";
    case "exam": return chooseLocalized(language, row.examNameAr, row.examNameEn) || "-";
    case "category": return row.caseCategory || "-";
    case "priority": return chooseLocalized(language, row.priorityNameAr, row.priorityNameEn) || "-";
    case "status": return statusLabel(language, row.status);
    case "phone": return includePhones ? row.phone1 || "-" : "Hidden";
    case "identifier": return includeIdentifiers ? row.mrn || row.nationalId || "-" : "Restricted";
    default: return "";
  }
}

function appointmentExportRow(row: AppointmentWithDetails, language: "ar" | "en", includePhones: boolean, includeIdentifiers: boolean) {
  return {
    Date: formatDateLy(row.appointmentDate),
    Time: row.bookingTime || "",
    Patient: chooseLocalized(language, row.arabicFullName, row.englishFullName),
    Accession: row.accessionNumber,
    Modality: chooseLocalized(language, row.modalityNameAr, row.modalityNameEn) || "",
    Exam: chooseLocalized(language, row.examNameAr, row.examNameEn) || "",
    Category: row.caseCategory || "",
    Priority: chooseLocalized(language, row.priorityNameAr, row.priorityNameEn) || "",
    Status: row.status,
    Phone: includePhones ? row.phone1 || "" : "",
    Identifier: includeIdentifiers ? row.mrn || row.nationalId || "" : "",
  };
}

function auditExportRow(row: AuditEntry) {
  const values = asRecord(row.newValues);
  return {
    Time: row.createdAt || "",
    Output: values.outputType || row.actionType,
    Template: values.reportTemplate || "",
    Rows: values.rowCount ?? "",
    IncludePhones: Boolean(values.includePhoneNumbers),
    IncludeIdentifiers: Boolean(values.includePatientIdentifiers),
    UserId: row.changedByUserId ?? "",
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function downloadPdf(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

async function browserPrintReport(model: ReportCenterRenderModel): Promise<void> {
  try {
    const blob = await fetchReportCenterPdf(model);
    const url = URL.createObjectURL(blob);
    const printWindow = window.open(url, "_blank");
    if (!printWindow) { URL.revokeObjectURL(url); throw new Error("The browser blocked the print window."); }
    printWindow.addEventListener("load", () => { printWindow.focus(); printWindow.print(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000); }, { once: true });
  } catch (error) {
    pushToast({ type: "error", title: "Browser printing failed", message: error instanceof Error ? error.message : "The report could not be opened for browser printing." });
  }
}

function buildGroupedCounts(rows: AppointmentWithDetails[], grouping: string, language: "ar" | "en") {
  if (!grouping) return [];
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    const label = grouping === "modality"
      ? chooseLocalized(language, row.modalityNameAr, row.modalityNameEn) || "Unknown"
      : grouping === "status"
        ? row.status || "Unknown"
        : row.caseCategory || "Uncategorized";
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  return Array.from(counts, ([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

function toCsv(rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return [headers.map(escape).join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n");
}

function downloadText(fileName: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(anchor.href);
    anchor.remove();
  }, 1000);
}

function loadPresets(): ReportPreset[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(PRESETS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, 12) : [];
  } catch {
    return [];
  }
}
