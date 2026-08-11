import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/shared/Button";
import {
  confirmPatientImportBatch,
  fetchPatientImportBatch,
  fetchPatientImportRows,
  inspectPatientImportWorkbook,
  previewPatientImport,
  selectPatientImportRows,
} from "@/lib/api-hooks";
import { useLanguage } from "@/providers/language-provider";

async function fileToBase64(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }

  return btoa(binary);
}

export default function PatientImportSection({
  onReAuthRequired,
  reauthVersion
}: {
  onReAuthRequired: (key: string[]) => void;
  reauthVersion: number;
}) {
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const [fileName, setFileName] = useState("");
  const [fileContentBase64, setFileContentBase64] = useState("");
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheetName, setSelectedSheetName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState({
    arabic_full_name: "",
    national_id: "",
    phone: "",
  });
  const [batchCategory, setBatchCategory] = useState<"oncology" | "non_oncology">("non_oncology");
  const [batchId, setBatchId] = useState<number | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [pendingRetry, setPendingRetry] = useState<
    | { kind: "inspect" }
    | { kind: "preview" }
    | { kind: "confirm" }
    | { kind: "select"; rowIds: number[]; selected: boolean }
    | null
  >(null);

  const isReauthError = (err: unknown): boolean => {
    const message = err instanceof Error ? err.message : String(err || "");
    return message.includes("re-authentication") || message.includes("403");
  };

  const inspectMutation = useMutation({
    mutationFn: inspectPatientImportWorkbook,
    onSuccess: (result) => {
      const workbook = result.workbook;
      setSheetNames(workbook.sheetNames || []);
      setSelectedSheetName(workbook.selectedSheetName || "");
      setHeaders(workbook.headers || []);
      setLocalError(null);
    },
    onError: (err: unknown) => {
      if (isReauthError(err)) {
        setPendingRetry({ kind: "inspect" });
        onReAuthRequired(["patient-import"]);
        return;
      }
      const message = err instanceof Error ? err.message : "Failed to inspect workbook.";
      setLocalError(message);
    }
  });

  const previewMutation = useMutation({
    mutationFn: previewPatientImport,
    onSuccess: (result) => {
      setBatchId(Number(result.batch.id));
      setLocalError(null);
      queryClient.invalidateQueries({ queryKey: ["patient-import-batch", Number(result.batch.id)] });
      queryClient.invalidateQueries({ queryKey: ["patient-import-rows", Number(result.batch.id)] });
    },
    onError: (err: unknown) => {
      if (isReauthError(err)) {
        setPendingRetry({ kind: "preview" });
        onReAuthRequired(["patient-import"]);
        return;
      }
      const message = err instanceof Error ? err.message : "Failed to stage import.";
      setLocalError(message);
    }
  });

  const { data: batchData, isLoading: batchLoading } = useQuery({
    queryKey: ["patient-import-batch", batchId],
    queryFn: () => fetchPatientImportBatch(Number(batchId)),
    enabled: batchId !== null
  });

  const { data: rowsData = [], isLoading: rowsLoading } = useQuery({
    queryKey: ["patient-import-rows", batchId],
    queryFn: () => fetchPatientImportRows(Number(batchId)),
    enabled: batchId !== null
  });

  const selectMutation = useMutation({
    mutationFn: ({ rowIds, selected }: { rowIds: number[]; selected: boolean }) =>
      selectPatientImportRows(Number(batchId), rowIds, selected),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["patient-import-rows", batchId] });
      await queryClient.invalidateQueries({ queryKey: ["patient-import-batch", batchId] });
    },
    onError: (err: unknown) => {
      if (isReauthError(err)) {
        onReAuthRequired(["patient-import"]);
        return;
      }
      const message = err instanceof Error ? err.message : "Failed to update selection.";
      setLocalError(message);
    }
  });

  const confirmMutation = useMutation({
    mutationFn: () => confirmPatientImportBatch(Number(batchId)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["patient-import-rows", batchId] });
      await queryClient.invalidateQueries({ queryKey: ["patient-import-batch", batchId] });
      setLocalError(null);
    },
    onError: (err: unknown) => {
      if (isReauthError(err)) {
        setPendingRetry({ kind: "confirm" });
        onReAuthRequired(["patient-import"]);
        return;
      }
      const message = err instanceof Error ? err.message : "Failed to confirm migration.";
      setLocalError(message);
    }
  });

  useEffect(() => {
    if (!pendingRetry) return;

    if (pendingRetry.kind === "inspect") {
      setPendingRetry(null);
      void handleInspectWorkbook();
      return;
    }

    if (pendingRetry.kind === "preview") {
      setPendingRetry(null);
      void handleStagePreview();
      return;
    }

    if (pendingRetry.kind === "confirm") {
      setPendingRetry(null);
      confirmMutation.mutate();
      return;
    }

    if (pendingRetry.kind === "select") {
      const payload = pendingRetry;
      setPendingRetry(null);
      selectMutation.mutate({ rowIds: payload.rowIds, selected: payload.selected });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reauthVersion]);

  const handleInspectWorkbook = async () => {
    if (!fileContentBase64) {
      setLocalError("Please upload an Excel file first.");
      return;
    }
    try {
      const result = await inspectMutation.mutateAsync({ fileContentBase64, sheetName: selectedSheetName || undefined });
      const workbook = result.workbook;
      if (workbook.selectedSheetName) {
        setSelectedSheetName(workbook.selectedSheetName);
      }
    } catch {
      // handled in mutation
    }
  };

  const handlePickFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setBatchId(null);
    setRowsAndErrorsReset();

    try {
      const base64 = await fileToBase64(file);
      setFileContentBase64(base64);
      setSheetNames([]);
      setHeaders([]);
      setSelectedSheetName("");
      setLocalError(null);
    } catch {
      // handled in mutation
    } finally {
      event.target.value = "";
    }
  };

  const setRowsAndErrorsReset = () => {
    setSheetNames([]);
    setHeaders([]);
    setMapping({ arabic_full_name: "", national_id: "", phone: "" });
    setBatchCategory("non_oncology");
    setLocalError(null);
  };

  const handleSheetChange = async (sheetName: string) => {
    setSelectedSheetName(sheetName);
    if (!fileContentBase64) return;
    try {
      await inspectMutation.mutateAsync({ fileContentBase64, sheetName });
    } catch {
      // handled in mutation
    }
  };

  const handleStagePreview = async () => {
    if (!fileContentBase64) {
      setLocalError("Please upload an Excel file first.");
      return;
    }
    if (!mapping.arabic_full_name || !mapping.national_id) {
      setLocalError("Please map Arabic full name and National ID columns.");
      return;
    }

    await previewMutation.mutateAsync({
      fileName: fileName || "patient-import.xlsx",
      fileContentBase64,
      sheetName: selectedSheetName || undefined,
      patientCategory: batchCategory,
      mapping: {
        arabic_full_name: mapping.arabic_full_name,
        national_id: mapping.national_id,
        phone: mapping.phone || undefined
      }
    });
  };

  const validRows = rowsData.filter((row) => row.validation_status === "valid");
  const selectedValidRows = validRows.filter((row) => row.is_selected_for_migration);
  const validRowIds = validRows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0);

  const handleSelectAllValid = () => {
    if (validRowIds.length === 0) return;
    selectMutation.mutate(
      { rowIds: validRowIds, selected: true },
      {
        onError: (err: unknown) => {
          if (isReauthError(err)) {
            setPendingRetry({ kind: "select", rowIds: validRowIds, selected: true });
            onReAuthRequired(["patient-import"]);
          }
        }
      }
    );
  };

  const handleClearSelection = () => {
    if (validRowIds.length === 0) return;
    selectMutation.mutate(
      { rowIds: validRowIds, selected: false },
      {
        onError: (err: unknown) => {
          if (isReauthError(err)) {
            setPendingRetry({ kind: "select", rowIds: validRowIds, selected: false });
            onReAuthRequired(["patient-import"]);
          }
        }
      }
    );
  };

  const rawErrorText =
    localError ||
    ((inspectMutation.error as Error | undefined)?.message ?? null) ||
    ((previewMutation.error as Error | undefined)?.message ?? null) ||
    ((confirmMutation.error as Error | undefined)?.message ?? null);
  const errorText = rawErrorText && isReauthError(rawErrorText) ? null : rawErrorText;

  const inProgressMessage = inspectMutation.isPending
    ? (language === "ar" ? "جاري قراءة الملف واستخراج الأعمدة..." : "Reading workbook and extracting headers...")
    : previewMutation.isPending
      ? (language === "ar" ? "جاري تجهيز الصفوف والتحقق من البيانات..." : "Staging rows and validating data...")
      : selectMutation.isPending
        ? (language === "ar" ? "جاري تحديث اختيار الصفوف..." : "Updating row selection...")
        : confirmMutation.isPending
          ? (language === "ar" ? "جاري ترحيل الصفوف المحددة إلى المرضى..." : "Migrating selected rows to live patients...")
          : (batchLoading || rowsLoading)
            ? (language === "ar" ? "جاري تحديث بيانات الدفعة..." : "Refreshing batch data...")
            : null;

  return (
    <div className="space-y-4">
      {inProgressMessage && (
        <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 text-sm space-y-2">
          <p>{inProgressMessage}</p>
          <div className="h-2 w-full rounded bg-blue-100 dark:bg-blue-800/40 overflow-hidden" aria-hidden>
            <div className="h-full w-1/2 bg-blue-500 dark:bg-blue-400 animate-pulse" />
          </div>
        </div>
      )}

      {errorText && (
        <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
          {errorText}
        </div>
      )}

      <div className="rounded-lg border border-stone-200 dark:border-stone-700 p-4 space-y-3">
        <h4 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
          {language === "ar" ? "1) رفع ملف Excel" : "1) Upload Excel file"}
        </h4>
        <input type="file" accept=".xlsx,.xls" onChange={handlePickFile} />
        {fileName ? <p className="text-xs text-stone-500">{fileName}</p> : null}
        <Button
          onClick={() => void handleInspectWorkbook()}
          disabled={!fileContentBase64 || inspectMutation.isPending}
          className="text-sm"
        >
          {inspectMutation.isPending
            ? (language === "ar" ? "جاري قراءة الأعمدة..." : "Reading headers...")
            : (language === "ar" ? "2) قراءة الأعمدة" : "2) Read workbook headers")}
        </Button>
      </div>

      {sheetNames.length > 0 && (
        <div className="rounded-lg border border-stone-200 dark:border-stone-700 p-4 space-y-3">
          <h4 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
            {language === "ar" ? "3) اختيار الورقة + ربط الأعمدة" : "3) Select sheet + map columns"}
          </h4>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-xs text-stone-700 dark:text-stone-300">
              {language === "ar" ? "Sheet" : "Sheet"}
              <select
                value={selectedSheetName}
                onChange={(e) => void handleSheetChange(e.target.value)}
                className="mt-1 w-full px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600"
              >
                {sheetNames.map((sheet) => (
                  <option key={sheet} value={sheet}>{sheet}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-stone-700 dark:text-stone-300">
              {language === "ar" ? "Batch category" : "Batch category"}
              <select
                value={batchCategory}
                onChange={(e) => setBatchCategory((e.target.value as "oncology" | "non_oncology") || "non_oncology")}
                className="mt-1 w-full px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600"
              >
                <option value="non_oncology">{language === "ar" ? "غير أورام" : "Non-oncology"}</option>
                <option value="oncology">{language === "ar" ? "أورام" : "Oncology"}</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="text-xs text-stone-700 dark:text-stone-300">
              {language === "ar" ? "Arabic full name (required)" : "Arabic full name (required)"}
              <select
                value={mapping.arabic_full_name}
                onChange={(e) => setMapping((prev) => ({ ...prev, arabic_full_name: e.target.value }))}
                className="mt-1 w-full px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600"
              >
                <option value="">--</option>
                {headers.map((header) => (
                  <option key={`ar-${header}`} value={header}>{header}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-stone-700 dark:text-stone-300">
              {language === "ar" ? "National ID (required)" : "National ID (required)"}
              <select
                value={mapping.national_id}
                onChange={(e) => setMapping((prev) => ({ ...prev, national_id: e.target.value }))}
                className="mt-1 w-full px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600"
              >
                <option value="">--</option>
                {headers.map((header) => (
                  <option key={`nid-${header}`} value={header}>{header}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-stone-700 dark:text-stone-300">
              {language === "ar" ? "Phone (optional)" : "Phone (optional)"}
              <select
                value={mapping.phone}
                onChange={(e) => setMapping((prev) => ({ ...prev, phone: e.target.value }))}
                className="mt-1 w-full px-3 py-1.5 rounded border bg-white dark:bg-stone-800 border-stone-300 dark:border-stone-600"
              >
                <option value="">--</option>
                {headers.map((header) => (
                  <option key={`phone-${header}`} value={header}>{header}</option>
                ))}
              </select>
            </label>
          </div>

          <Button
            onClick={() => void handleStagePreview()}
            disabled={previewMutation.isPending || inspectMutation.isPending}
            className="text-sm"
          >
            {previewMutation.isPending
              ? (language === "ar" ? "جاري الاستيراد إلى المرحلة..." : "Staging import...")
              : (language === "ar" ? "4) استيراد إلى المرحلة (Preview)" : "4) Stage import (Preview)")}
          </Button>
        </div>
      )}

      {batchId !== null && (
        <div className="rounded-lg border border-stone-200 dark:border-stone-700 p-4 space-y-4">
          <h4 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
            {language === "ar" ? "5) مراجعة الصفوف" : "5) Review staged rows"}
          </h4>

          {batchLoading ? (
            <p className="text-sm text-stone-500">{language === "ar" ? "جاري تحميل الملخص..." : "Loading summary..."}</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
              <div className="p-2 rounded bg-stone-100 dark:bg-stone-800">Total: {batchData?.total_rows ?? 0}</div>
              <div className="p-2 rounded bg-emerald-100 dark:bg-emerald-900/20">Valid: {batchData?.valid_rows ?? 0}</div>
              <div className="p-2 rounded bg-amber-100 dark:bg-amber-900/20">Invalid: {batchData?.invalid_rows ?? 0}</div>
              <div className="p-2 rounded bg-orange-100 dark:bg-orange-900/20">Duplicate: {batchData?.duplicate_rows ?? 0}</div>
              <div className="p-2 rounded bg-blue-100 dark:bg-blue-900/20">Migrated: {batchData?.migrated_rows ?? 0}</div>
              <div className="p-2 rounded bg-violet-100 dark:bg-violet-900/20">
                Category: {batchData?.patient_category === "oncology" ? (language === "ar" ? "أورام" : "Oncology") : (language === "ar" ? "غير أورام" : "Non-oncology")}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={handleSelectAllValid} disabled={selectMutation.isPending || validRowIds.length === 0}>
              {language === "ar" ? "تحديد كل الصفوف الصالحة" : "Select all valid rows"}
            </Button>
            <Button variant="secondary" onClick={handleClearSelection} disabled={selectMutation.isPending || validRowIds.length === 0}>
              {language === "ar" ? "إلغاء التحديد" : "Clear selection"}
            </Button>
            <Button
              onClick={() => confirmMutation.mutate()}
              disabled={confirmMutation.isPending || selectedValidRows.length === 0}
            >
              {confirmMutation.isPending
                ? (language === "ar" ? "جاري ترحيل البيانات..." : "Migrating...")
                : (language === "ar" ? "6) تأكيد الترحيل إلى المرضى" : "6) Confirm migration to live patients")}
            </Button>
          </div>

          {rowsLoading ? (
            <p className="text-sm text-stone-500">{language === "ar" ? "جاري تحميل الصفوف..." : "Loading rows..."}</p>
          ) : (
            <div className="max-h-[420px] overflow-auto border border-stone-200 dark:border-stone-700 rounded">
              <table className="w-full text-xs">
                <thead className="bg-stone-50 dark:bg-stone-800 sticky top-0">
                  <tr>
                    <th className="p-2 text-start">#</th>
                    <th className="p-2 text-start">AR</th>
                    <th className="p-2 text-start">EN</th>
                    <th className="p-2 text-start">NID</th>
                    <th className="p-2 text-start">Phone</th>
                    <th className="p-2 text-start">Sex</th>
                    <th className="p-2 text-start">DOB</th>
                    <th className="p-2 text-start">Age</th>
                    <th className="p-2 text-start">Status</th>
                    <th className="p-2 text-start">Message</th>
                    <th className="p-2 text-start">Select</th>
                  </tr>
                </thead>
                <tbody>
                  {rowsData.map((row) => (
                    <tr key={row.id} className="border-t border-stone-200 dark:border-stone-700">
                      <td className="p-2">{row.row_number}</td>
                      <td className="p-2">{row.arabic_full_name || "-"}</td>
                      <td className="p-2">{row.english_full_name || "-"}</td>
                      <td className="p-2">{row.national_id || "-"}</td>
                      <td className="p-2">{row.phone || "-"}</td>
                      <td className="p-2">{row.derived_sex || "-"}</td>
                      <td className="p-2">{row.derived_birth_date || "-"}</td>
                      <td className="p-2">{row.derived_age_years ?? "-"}</td>
                      <td className="p-2">{row.validation_status}</td>
                      <td className="p-2">{row.validation_message || "-"}</td>
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={row.is_selected_for_migration}
                          disabled={row.validation_status !== "valid" || selectMutation.isPending}
                          onChange={(event) =>
                            selectMutation.mutate(
                              {
                                rowIds: [Number(row.id)],
                                selected: event.target.checked
                              },
                              {
                                onError: (err: unknown) => {
                                  if (isReauthError(err)) {
                                    setPendingRetry({
                                      kind: "select",
                                      rowIds: [Number(row.id)],
                                      selected: event.target.checked
                                    });
                                    onReAuthRequired(["patient-import"]);
                                  }
                                }
                              }
                            )
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
