import { useState, type ChangeEvent } from "react";
import { ApiError } from "@/lib/api-client";
import {
  applyCatalogWorkbookImport,
  exportCatalogWorkbook,
  previewCatalogWorkbookImport,
} from "@/lib/api-hooks";
import { Button } from "@/components/shared/Button";

type ImportSummary = {
  modalitiesCreated: number;
  modalitiesUpdated: number;
  examTypesCreated: number;
  examTypesUpdated: number;
  skipped: number;
  errors: Array<{ sheet: string; rowNumber: number; column: string | null; message: string }>;
};

type CatalogImportError = {
  sheet: string;
  rowNumber: number;
  column: string | null;
  message: string;
  errorType?: string;
  severity?: string;
};

type DraftRow = Record<string, unknown> & {
  id?: unknown;
  action?: unknown;
  selected?: unknown;
  rowNumber?: unknown;
  modalityCode?: unknown;
  code?: unknown;
  nameEn?: unknown;
  nameAr?: unknown;
  dailyCapacity?: unknown;
  durationMinutes?: unknown;
  errors?: CatalogImportError[];
};

type Draft = {
  canApply: boolean;
  summary: { modalitiesTotal: number; examTypesTotal: number; selectedModalities: number; selectedExamTypes: number; errors: number; warnings: number };
  modalities: DraftRow[];
  examTypes: DraftRow[];
};

type RowFilter = "all" | "selected" | "errors" | "create" | "update" | "skip";

export default function CatalogImportExportPanel({ onImportSuccess }: { onImportSuccess: (summary: ImportSummary) => void }) {
  const [isExporting, setIsExporting] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<string | null>(null);
  const [progressNotes, setProgressNotes] = useState<string[]>([]);
  const [errorRows, setErrorRows] = useState<CatalogImportError[]>([]);
  const [modalityFilter, setModalityFilter] = useState<RowFilter>("all");
  const [examTypeFilter, setExamTypeFilter] = useState<RowFilter>("all");
  const [draft, setDraft] = useState<Draft | null>(null);

  const handleExport = async () => {
    try {
      setIsExporting(true);
      setErrorMessage(null);
      setErrorType(null);
      setErrorRows([]);
      await exportCatalogWorkbook();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Catalog export failed");
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      setIsPreviewing(true);
      setErrorMessage(null);
      setErrorType(null);
      setErrorRows([]);
      setProgressNotes(["Reading the selected workbook..."]);
      setModalityFilter("all");
      setExamTypeFilter("all");
      setDraft(null);

      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || "");
          const [, content = ""] = result.split(",", 2);
          resolve(content);
        };
        reader.onerror = () => reject(new Error("Failed to read the selected workbook."));
        reader.readAsDataURL(file);
      });

      const response = await previewCatalogWorkbookImport({ fileContentBase64: base64 });
      setDraft({
        canApply: response.preview.canApply,
        summary: response.preview.summary,
        modalities: response.preview.modalities as DraftRow[],
        examTypes: response.preview.examTypes as DraftRow[],
      });
      setProgressNotes(response.preview.progressNotes || []);
      setErrorRows((response.preview.errors || []) as CatalogImportError[]);
      if (!response.preview.canApply) {
        setErrorMessage("Preview found validation issues. Review and fix the rows before applying.");
        setErrorType("validation_failed");
      }
    } catch (error) {
      if (error instanceof ApiError) {
        const details = (error.details ?? {}) as {
          errors?: CatalogImportError[];
          errorType?: string;
          progressNotes?: string[];
        };
        setErrorRows(Array.isArray(details.errors) ? details.errors : []);
        setErrorType(details.errorType || `http_${error.status}`);
        setProgressNotes(Array.isArray(details.progressNotes) ? details.progressNotes : []);
        setErrorMessage(error.message || "Catalog import failed");
      } else {
        setErrorMessage(error instanceof Error ? error.message : "Catalog import failed");
        setErrorType("unknown_error");
      }
    } finally {
      setIsPreviewing(false);
    }
  };

  const updateDraftRow = (kind: "modalities" | "examTypes", rowId: string, field: string, value: unknown) => {
    setDraft((current) => {
      if (!current) return current;
      const nextRows = (current[kind] || []).map((row) => (
        String(row.id) === rowId ? { ...row, [field]: value } : row
      ));
      const selectedModalities = (kind === "modalities" ? nextRows : current.modalities).filter((row) => Boolean(row.selected)).length;
      const selectedExamTypes = (kind === "examTypes" ? nextRows : current.examTypes).filter((row) => Boolean(row.selected)).length;
      return { ...current, [kind]: nextRows, summary: { ...current.summary, selectedModalities, selectedExamTypes } };
    });
  };

  const filteredRows = (kind: "modalities" | "examTypes") => {
    if (!draft) return [];
    const filter = kind === "modalities" ? modalityFilter : examTypeFilter;
    return (draft[kind] || []).filter((row) => {
      if (filter === "all") return true;
      if (filter === "selected") return Boolean(row.selected);
      if (filter === "errors") return Array.isArray(row.errors) && row.errors.length > 0;
      return String(row.action) === filter;
    });
  };

  const bulkSetSelected = (kind: "modalities" | "examTypes", nextSelected: boolean, mode: "all" | "visible") => {
    setDraft((current) => {
      if (!current) return current;
      const visibleIds = new Set(filteredRows(kind).map((row) => String(row.id)));
      const nextRows = (current[kind] || []).map((row) => {
        if (String(row.action) === "invalid") return row;
        if (mode === "all" || visibleIds.has(String(row.id))) return { ...row, selected: nextSelected };
        return row;
      });
      const selectedModalities = (kind === "modalities" ? nextRows : current.modalities).filter((row) => Boolean(row.selected)).length;
      const selectedExamTypes = (kind === "examTypes" ? nextRows : current.examTypes).filter((row) => Boolean(row.selected)).length;
      return { ...current, [kind]: nextRows, summary: { ...current.summary, selectedModalities, selectedExamTypes } };
    });
  };

  const handleApply = async () => {
    if (!draft) return;
    try {
      setIsApplying(true);
      setErrorMessage(null);
      setErrorType(null);
      setProgressNotes((current) => [...current, "Applying the selected reviewed rows in one transaction..."]);
      const response = await applyCatalogWorkbookImport({ modalities: draft.modalities, examTypes: draft.examTypes });
      onImportSuccess(response.summary);
      setDraft(null);
      setErrorRows([]);
      setProgressNotes(["Preview completed.", "Selected rows were applied successfully."]);
    } catch (error) {
      if (error instanceof ApiError) {
        const details = (error.details ?? {}) as {
          errors?: CatalogImportError[];
          errorType?: string;
        };
        setErrorRows(Array.isArray(details.errors) ? details.errors : []);
        setErrorType(details.errorType || `http_${error.status}`);
        setErrorMessage(error.message || "Catalog import apply failed");
      } else {
        setErrorMessage(error instanceof Error ? error.message : "Catalog import apply failed");
        setErrorType("unknown_error");
      }
    } finally {
      setIsApplying(false);
    }
  };

  const renderRows = (kind: "modalities" | "examTypes") => (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="text-left border-b border-stone-200 dark:border-stone-700">
            <th className="py-2 pr-2">Use</th>
            <th className="py-2 pr-2">Action</th>
            <th className="py-2 pr-2">Row</th>
            {kind === "examTypes" && <th className="py-2 pr-2">Modality</th>}
            <th className="py-2 pr-2">Code</th>
            <th className="py-2 pr-2">Name EN</th>
            <th className="py-2 pr-2">Name AR</th>
            <th className="py-2 pr-2">{kind === "modalities" ? "Capacity" : "Minutes"}</th>
            <th className="py-2 pr-2">Notes</th>
          </tr>
        </thead>
        <tbody>
          {filteredRows(kind).map((row) => (
            <tr key={String(row.id)} className="border-b border-stone-100 dark:border-stone-800 align-top">
              <td className="py-2 pr-2">
                <input type="checkbox" checked={Boolean(row.selected)} onChange={(e) => updateDraftRow(kind, String(row.id), "selected", e.target.checked)} disabled={String(row.action) === "invalid"} />
              </td>
              <td className="py-2 pr-2"><span className="font-mono uppercase">{String(row.action)}</span></td>
              <td className="py-2 pr-2">{String(row.rowNumber)}</td>
              {kind === "examTypes" && <td className="py-2 pr-2"><input value={String(row.modalityCode ?? "")} onChange={(e) => updateDraftRow(kind, String(row.id), "modalityCode", e.target.value)} className="w-24 px-2 py-1 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600" /></td>}
              <td className="py-2 pr-2"><input value={String(row.code ?? "")} onChange={(e) => updateDraftRow(kind, String(row.id), "code", e.target.value)} className="w-28 px-2 py-1 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600" /></td>
              <td className="py-2 pr-2"><input value={String(row.nameEn ?? "")} onChange={(e) => updateDraftRow(kind, String(row.id), "nameEn", e.target.value)} className="w-40 px-2 py-1 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600" /></td>
              <td className="py-2 pr-2"><input value={String(row.nameAr ?? "")} onChange={(e) => updateDraftRow(kind, String(row.id), "nameAr", e.target.value)} className="w-40 px-2 py-1 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600" /></td>
              <td className="py-2 pr-2">
                {kind === "modalities" ? (
                  <input type="number" value={Number(row.dailyCapacity ?? 0)} onChange={(e) => updateDraftRow(kind, String(row.id), "dailyCapacity", Number(e.target.value) || 0)} className="w-20 px-2 py-1 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600" />
                ) : (
                  <input type="number" value={row.durationMinutes == null ? "" : Number(row.durationMinutes)} onChange={(e) => updateDraftRow(kind, String(row.id), "durationMinutes", e.target.value === "" ? null : Number(e.target.value))} className="w-20 px-2 py-1 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600" />
                )}
              </td>
              <td className="py-2 pr-2">
                {Array.isArray(row.errors) && row.errors.length > 0 ? (
                  <div className="text-red-600 dark:text-red-300 max-w-xs">{row.errors.map((item) => item.errorType || item.message).join(", ")}</div>
                ) : (
                  <div className="text-stone-500">Ready</div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="rounded-lg border border-stone-200 dark:border-stone-700 p-4 bg-stone-50/80 dark:bg-stone-800/40 space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm">
          <p className="font-medium text-stone-900 dark:text-white">Excel import/export</p>
          <p className="description-center">One workbook includes both the Modalities and ExamTypes sheets.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={handleExport} disabled={isExporting || isPreviewing || isApplying} className="text-xs">{isExporting ? "Exporting..." : "Export Excel"}</Button>
          <label className="inline-flex items-center px-3 py-2 rounded-md bg-teal-600 hover:bg-teal-700 text-white text-xs font-medium cursor-pointer disabled:opacity-60">
            {isPreviewing ? "Reviewing..." : "Import Excel"}
            <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={handleImportChange} className="sr-only" disabled={isExporting || isPreviewing || isApplying} />
          </label>
          {draft && <Button variant="secondary" onClick={handleApply} disabled={isApplying || !draft.canApply} className="text-xs">{isApplying ? "Applying..." : "Apply Selected Rows"}</Button>}
        </div>
      </div>

      {progressNotes.length > 0 && (
        <div className="rounded-lg border border-blue-200 dark:border-blue-900/60 bg-blue-50 dark:bg-blue-950/30 p-3 text-sm text-blue-700 dark:text-blue-300">
          <p className="font-medium mb-1">Progress notes</p>
          <ul className="space-y-1">{progressNotes.map((note, index) => <li key={`${note}-${index}`}>{index + 1}. {note}</li>)}</ul>
        </div>
      )}

      {errorMessage && (
        <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-3 text-sm text-red-700 dark:text-red-300 space-y-2">
          <p>{errorMessage}</p>
          {errorType && <p className="text-xs font-mono">errorType: {errorType}</p>}
          {errorRows.length > 0 && (
            <ul className="space-y-1">
              {errorRows.slice(0, 8).map((item, index) => <li key={`${item.sheet}-${item.rowNumber}-${item.column || "none"}-${index}`}>{item.sheet} row {item.rowNumber}{item.column ? ` (${item.column})` : ""}: {item.message}{item.errorType ? ` [${item.errorType}]` : ""}</li>)}
            </ul>
          )}
        </div>
      )}

      {draft && (
        <div className="space-y-3">
          <div className="rounded-lg border border-stone-200 dark:border-stone-700 p-3 text-sm bg-white/70 dark:bg-stone-900/20">
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-2">
              <div className="rounded border border-stone-200 dark:border-stone-700 p-2"><div className="text-[10px] uppercase font-mono">Modality Rows</div><div className="font-semibold">{draft.summary.modalitiesTotal}</div></div>
              <div className="rounded border border-stone-200 dark:border-stone-700 p-2"><div className="text-[10px] uppercase font-mono">Exam Rows</div><div className="font-semibold">{draft.summary.examTypesTotal}</div></div>
              <div className="rounded border border-stone-200 dark:border-stone-700 p-2"><div className="text-[10px] uppercase font-mono">Selected Modalities</div><div className="font-semibold">{draft.summary.selectedModalities}</div></div>
              <div className="rounded border border-stone-200 dark:border-stone-700 p-2"><div className="text-[10px] uppercase font-mono">Selected Exams</div><div className="font-semibold">{draft.summary.selectedExamTypes}</div></div>
              <div className="rounded border border-amber-200 dark:border-amber-800 p-2"><div className="text-[10px] uppercase font-mono">Warnings</div><div className="font-semibold">{draft.summary.warnings}</div></div>
              <div className="rounded border border-red-200 dark:border-red-800 p-2"><div className="text-[10px] uppercase font-mono">Errors</div><div className="font-semibold">{draft.summary.errors}</div></div>
            </div>
          </div>

          {(["modalities", "examTypes"] as const).map((kind) => (
            <details key={kind} className="rounded-lg border border-stone-200 dark:border-stone-700 p-3 bg-white/70 dark:bg-stone-900/20" open>
              <summary className="cursor-pointer font-medium text-sm">Review {kind === "modalities" ? "modality" : "exam type"} rows</summary>
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap gap-2 items-center">
                  <select value={kind === "modalities" ? modalityFilter : examTypeFilter} onChange={(e) => kind === "modalities" ? setModalityFilter(e.target.value as RowFilter) : setExamTypeFilter(e.target.value as RowFilter)} className="px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600 text-xs">
                    <option value="all">All {kind === "modalities" ? "modality" : "exam"} rows</option>
                    <option value="selected">Selected only</option>
                    <option value="errors">Errors only</option>
                    <option value="create">Creates</option>
                    <option value="update">Updates</option>
                    <option value="skip">Skips</option>
                  </select>
                  <button onClick={() => bulkSetSelected(kind, true, "visible")} className="px-2.5 py-1.5 rounded bg-stone-100 dark:bg-stone-700 text-xs">Select Visible</button>
                  <button onClick={() => bulkSetSelected(kind, false, "visible")} className="px-2.5 py-1.5 rounded bg-stone-100 dark:bg-stone-700 text-xs">Clear Visible</button>
                  <button onClick={() => bulkSetSelected(kind, true, "all")} className="px-2.5 py-1.5 rounded bg-stone-100 dark:bg-stone-700 text-xs">Select All</button>
                  <button onClick={() => bulkSetSelected(kind, false, "all")} className="px-2.5 py-1.5 rounded bg-stone-100 dark:bg-stone-700 text-xs">Clear All</button>
                  <span className="text-xs description-center">{filteredRows(kind).length} visible</span>
                </div>
                {renderRows(kind)}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
