import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  adminBulkDeleteDocuments,
  adminMoveDocumentsToStorage,
  adminTestDocumentStorageConnectivity,
  fetchSettings,
  saveSettings,
} from "@/lib/api-hooks";
import { scanAppointmentRequest } from "@/lib/naps2-webscan";
import { useLanguage } from "@/providers/language-provider";
import { QueryError, ReAuthPrompt } from "./settings-section-helpers";

type DocumentsStorageForm = {
  storagePath: string;
  authUsername: string;
  authPassword: string;
  authDomain: string;
  fallbackEnabled: boolean;
  naps2WebScanEnabled: boolean;
  naps2WebScanEndpoint: string;
  scannerAppEnabled: boolean;
  scannerAppDownloadUrl: string;
  scanSessionExpiryMinutes: string;
  scanDpi: string;
  scanColorMode: string;
  scannerSource: string;
};

type DocumentsStorageFormOverride = {
  baseUpdatedAt: number;
  value: DocumentsStorageForm;
};

function normalizeDocumentsStorageForm(
  settings: Record<string, string> | undefined
): DocumentsStorageForm {
  return {
    storagePath: settings?.storage_path || "",
    authUsername: settings?.storage_auth_username || "",
    authPassword: settings?.storage_auth_password || "",
    authDomain: settings?.storage_auth_domain || "",
    fallbackEnabled: String(settings?.storage_fallback_enabled || "true").toLowerCase() === "true",
    naps2WebScanEnabled: String(settings?.naps2_webscan_enabled || "disabled").toLowerCase() === "enabled",
    naps2WebScanEndpoint: settings?.naps2_webscan_endpoint || "http://127.0.0.1:9801",
    scannerAppEnabled: String(settings?.scanner_app_enabled || "enabled").toLowerCase() === "enabled",
    scannerAppDownloadUrl: settings?.scanner_app_download_url || "/assets/downloads/RISproScannerSetup.msi",
    scanSessionExpiryMinutes: settings?.scan_session_expiry_minutes || "15",
    scanDpi: settings?.scan_dpi || "200",
    scanColorMode: settings?.scan_color_mode || "grayscale",
    scannerSource: settings?.scanner_source || "feeder",
  };
}

export default function DocumentsStorageSection({ onReAuthRequired }: { onReAuthRequired: (key: string[]) => void }) {
  const queryClient = useQueryClient();
  const { t, language } = useLanguage();
  const [formOverride, setFormOverride] = useState<DocumentsStorageFormOverride | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [resultMessage, setResultMessage] = useState<string>("");

  const { data: settings, dataUpdatedAt, error, isLoading } = useQuery({
    queryKey: ["settings", "documents_and_uploads"],
    queryFn: () => fetchSettings("documents_and_uploads"),
    staleTime: 1000 * 60,
  });

  const serverForm = normalizeDocumentsStorageForm(settings);
  const form =
    formOverride?.baseUpdatedAt === dataUpdatedAt
      ? formOverride.value
      : serverForm;
  const updateForm = <K extends keyof DocumentsStorageForm,>(
    key: K,
    value: DocumentsStorageForm[K]
  ) => {
    setFormOverride((currentOverride) => {
      const currentForm =
        currentOverride?.baseUpdatedAt === dataUpdatedAt
          ? currentOverride.value
          : serverForm;

      return {
        baseUpdatedAt: dataUpdatedAt,
        value: {
          ...currentForm,
          [key]: value,
        },
      };
    });
  };

  const saveMutation = useMutation({
    mutationFn: async () =>
      saveSettings("documents_and_uploads", {
        entries: [
          { key: "storage_path", value: { value: form.storagePath } },
          { key: "storage_auth_username", value: { value: form.authUsername } },
          { key: "storage_auth_password", value: { value: form.authPassword } },
          { key: "storage_auth_domain", value: { value: form.authDomain } },
          { key: "storage_fallback_enabled", value: { value: String(form.fallbackEnabled) } },
          { key: "naps2_webscan_enabled", value: { value: form.naps2WebScanEnabled ? "enabled" : "disabled" } },
          { key: "naps2_webscan_endpoint", value: { value: form.naps2WebScanEndpoint } },
          { key: "scanner_bridge_mode", value: { value: form.naps2WebScanEnabled ? "naps2_webscan" : "manual_browser_upload" } },
          { key: "scanner_app_enabled", value: { value: form.scannerAppEnabled ? "enabled" : "disabled" } },
          { key: "scanner_app_download_url", value: { value: form.scannerAppDownloadUrl } },
          { key: "scan_session_expiry_minutes", value: { value: form.scanSessionExpiryMinutes } },
          { key: "scan_dpi", value: { value: form.scanDpi } },
          { key: "scan_color_mode", value: { value: form.scanColorMode } },
          { key: "scanner_source", value: { value: form.scannerSource } },
          { key: "scan_file_format", value: { value: "pdf" } },
        ],
      }),
    onSuccess: () => {
      setResultMessage(t("settings.documents.saved"));
      queryClient.invalidateQueries({ queryKey: ["settings", "documents_and_uploads"] });
      queryClient.invalidateQueries({ queryKey: ["integration-status", "documents"] });
    },
    onError: (err: unknown) => {
      setResultMessage(err instanceof Error ? err.message : t("settings.documents.saveFailed"));
    },
  });

  const testMutation = useMutation({
    mutationFn: adminTestDocumentStorageConnectivity,
    onSuccess: (result) => {
      setResultMessage(result.ok ? t("settings.documents.connectivityOk", { message: result.message }) : t("settings.documents.connectivityFailed", { message: result.message }));
    },
    onError: (err: unknown) => {
      setResultMessage(err instanceof Error ? err.message : t("settings.documents.connectivityTestFailed"));
    },
  });

  const testNaps2Mutation = useMutation({
    mutationFn: () => scanAppointmentRequest({
      endpoint: form.naps2WebScanEndpoint,
      dpi: Number(form.scanDpi) || 200,
      colorMode: form.scanColorMode === "color" ? "color" : "grayscale",
      source: form.scannerSource === "flatbed" ? "flatbed" : form.scannerSource === "duplex" ? "duplex" : "feeder",
      fileName: "naps2-test-scan.pdf",
    }),
    onSuccess: (result) => {
      setResultMessage(t("settings.documents.naps2TestOk", { pageCount: result.pageCount, fileName: result.file.name }));
    },
    onError: (err: unknown) => {
      setResultMessage(err instanceof Error ? err.message : t("settings.documents.naps2TestFailed", { message: "NAPS2.WebScan is not reachable." }));
    },
  });

  const deleteAllMutation = useMutation({
    mutationFn: () => adminBulkDeleteDocuments({ mode: "all" }),
    onSuccess: (result) => {
      setResultMessage(language === "ar"
        ? `تم حذف ${result.deletedCount} وثيقة. فشل: ${result.failedCount}.`
        : `Deleted ${result.deletedCount} documents. Failed: ${result.failedCount}.`);
    },
    onError: (err: unknown) => {
      setResultMessage(err instanceof Error ? err.message : t("settings.documents.deleteAllFailed"));
    },
  });

  const deleteRangeMutation = useMutation({
    mutationFn: () => adminBulkDeleteDocuments({ mode: "appointment_date_range", dateFrom, dateTo }),
    onSuccess: (result) => {
      setResultMessage(language === "ar"
        ? `تم حذف ${result.deletedCount} وثيقة ضمن النطاق. فشل: ${result.failedCount}.`
        : `Deleted ${result.deletedCount} documents in range. Failed: ${result.failedCount}.`);
    },
    onError: (err: unknown) => {
      setResultMessage(err instanceof Error ? err.message : t("settings.documents.deleteRangeFailed"));
    },
  });

  const moveAllMutation = useMutation({
    mutationFn: () => adminMoveDocumentsToStorage({ mode: "all" }),
    onSuccess: (result) => {
      setResultMessage(language === "ar"
        ? `تم نقل ${result.movedCount} وثيقة. تم التجاوز: ${result.skippedCount}. فشل: ${result.failedCount}.`
        : `Moved ${result.movedCount} docs. Skipped: ${result.skippedCount}. Failed: ${result.failedCount}.`);
    },
    onError: (err: unknown) => {
      setResultMessage(err instanceof Error ? err.message : t("settings.documents.moveAllFailed"));
    },
  });

  const moveRangeMutation = useMutation({
    mutationFn: () => adminMoveDocumentsToStorage({ mode: "appointment_date_range", dateFrom, dateTo }),
    onSuccess: (result) => {
      setResultMessage(language === "ar"
        ? `تم نقل ${result.movedCount} وثيقة ضمن النطاق. تم التجاوز: ${result.skippedCount}. فشل: ${result.failedCount}.`
        : `Moved ${result.movedCount} docs in range. Skipped: ${result.skippedCount}. Failed: ${result.failedCount}.`);
    },
    onError: (err: unknown) => {
      setResultMessage(err instanceof Error ? err.message : t("settings.documents.moveRangeFailed"));
    },
  });

  if (error) {
    const msg = (error as Error).message;
    if (msg?.includes("re-authentication") || msg?.includes("403")) {
      return <ReAuthPrompt onReAuthRequired={() => onReAuthRequired(["settings", "documents_and_uploads"])} />;
    }
    return <QueryError message={msg} />;
  }

  if (isLoading) {
    return <p className="description-center">{t("settings.documents.loading")}</p>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-stone-200 dark:border-stone-700 p-3 space-y-3">
        <h4 className="font-medium text-sm">{t("settings.documents.naps2Title")}</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex items-end">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.scannerAppEnabled}
                onChange={(e) => updateForm("scannerAppEnabled", e.target.checked)}
              />
              {t("settings.documents.scannerAppEnabled")}
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t("settings.documents.scannerAppDownloadUrl")}</label>
            <input
              value={form.scannerAppDownloadUrl}
              onChange={(e) => updateForm("scannerAppDownloadUrl", e.target.value)}
              placeholder="/assets/downloads/RISproScannerSetup.msi"
              className="input-premium w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t("settings.documents.scanSessionExpiryMinutes")}</label>
            <select value={form.scanSessionExpiryMinutes} onChange={(e) => updateForm("scanSessionExpiryMinutes", e.target.value)} className="input-premium w-full">
              <option value="10">10</option>
              <option value="15">15</option>
              <option value="30">30</option>
            </select>
          </div>
          <div className="flex items-end">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.naps2WebScanEnabled}
                onChange={(e) => updateForm("naps2WebScanEnabled", e.target.checked)}
              />
              {t("settings.documents.naps2Enabled")}
            </label>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t("settings.documents.naps2Endpoint")}</label>
            <input
              value={form.naps2WebScanEndpoint}
              onChange={(e) => updateForm("naps2WebScanEndpoint", e.target.value)}
              placeholder="http://127.0.0.1:9801"
              className="input-premium w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t("settings.documents.scanDpi")}</label>
            <select value={form.scanDpi} onChange={(e) => updateForm("scanDpi", e.target.value)} className="input-premium w-full">
              <option value="150">150</option>
              <option value="200">200</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t("settings.documents.scanColorMode")}</label>
            <select value={form.scanColorMode} onChange={(e) => updateForm("scanColorMode", e.target.value)} className="input-premium w-full">
              <option value="grayscale">{t("settings.documents.grayscale")}</option>
              <option value="color">{t("settings.documents.color")}</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{t("settings.documents.scannerSource")}</label>
            <select value={form.scannerSource} onChange={(e) => updateForm("scannerSource", e.target.value)} className="input-premium w-full">
              <option value="feeder">{t("settings.documents.feeder")}</option>
              <option value="flatbed">{t("settings.documents.flatbed")}</option>
              <option value="duplex">{t("settings.documents.duplex")}</option>
            </select>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => testNaps2Mutation.mutate()}
            disabled={testNaps2Mutation.isPending}
          >
            {testNaps2Mutation.isPending ? t("settings.documents.naps2Testing") : t("settings.documents.naps2Test")}
          </button>
        </div>
        <p className="text-xs description-center">{t("settings.documents.naps2Help")}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium mb-1">{t("settings.documents.storagePath")}</label>
          <input value={form.storagePath} onChange={(e) => updateForm("storagePath", e.target.value)} className="input-premium w-full" />
        </div>
        <div className="flex items-end">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.fallbackEnabled} onChange={(e) => updateForm("fallbackEnabled", e.target.checked)} />
            {t("settings.documents.enableFallback")}
          </label>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t("settings.documents.networkUsername")}</label>
          <input value={form.authUsername} onChange={(e) => updateForm("authUsername", e.target.value)} className="input-premium w-full" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t("settings.documents.networkPassword")}</label>
          <input type="password" value={form.authPassword} onChange={(e) => updateForm("authPassword", e.target.value)} className="input-premium w-full" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">{t("settings.documents.networkDomain")}</label>
          <input value={form.authDomain} onChange={(e) => updateForm("authDomain", e.target.value)} className="input-premium w-full" />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => saveMutation.mutate()} className="btn-primary text-sm" disabled={saveMutation.isPending}>
          {saveMutation.isPending ? t("common.loading") : t("settings.documents.save")}
        </button>
        <button onClick={() => testMutation.mutate()} className="btn-secondary text-sm" disabled={testMutation.isPending}>
          {testMutation.isPending ? t("common.loading") : t("settings.documents.testing")}
        </button>
      </div>

      <div className="rounded-lg border border-stone-200 dark:border-stone-700 p-3 space-y-3">
        <h4 className="font-medium text-sm">{t("settings.documents.bulkJobs")}</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <div>
            <label className="block text-xs mb-1">{t("settings.documents.fromDate")}</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="input-premium w-full" />
          </div>
          <div>
            <label className="block text-xs mb-1">{t("settings.documents.toDate")}</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="input-premium w-full" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="px-3 py-1.5 text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded"
            onClick={() => {
              if (!window.confirm(t("settings.documents.deleteAllConfirm"))) return;
              deleteAllMutation.mutate();
            }}
            disabled={deleteAllMutation.isPending}
          >
            {deleteAllMutation.isPending ? t("common.loading") : t("settings.documents.deleteAll")}
          </button>
          <button
            className="px-3 py-1.5 text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded"
            onClick={() => {
              if (!dateFrom || !dateTo) {
                setResultMessage(t("settings.documents.selectBothDates"));
                return;
              }
              if (!window.confirm(t("settings.documents.deleteRangeConfirm"))) return;
              deleteRangeMutation.mutate();
            }}
            disabled={deleteRangeMutation.isPending}
          >
            {deleteRangeMutation.isPending ? t("common.loading") : t("settings.documents.deleteRange")}
          </button>
          <button
            className="px-3 py-1.5 text-xs bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 rounded"
            onClick={() => moveAllMutation.mutate()}
            disabled={moveAllMutation.isPending}
          >
            {moveAllMutation.isPending ? t("common.loading") : t("settings.documents.moveAll")}
          </button>
          <button
            className="px-3 py-1.5 text-xs bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 rounded"
            onClick={() => {
              if (!dateFrom || !dateTo) {
                setResultMessage(t("settings.documents.selectBothDates"));
                return;
              }
              moveRangeMutation.mutate();
            }}
            disabled={moveRangeMutation.isPending}
          >
            {moveRangeMutation.isPending ? t("common.loading") : t("settings.documents.moveRange")}
          </button>
        </div>
      </div>

      {resultMessage && (
        <div className="p-3 rounded border border-stone-200 dark:border-stone-700 text-sm">
          {resultMessage}
        </div>
      )}
    </div>
  );
}
