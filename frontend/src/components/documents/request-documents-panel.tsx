import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLanguage } from "@/providers/language-provider";
import {
  deleteAppointmentDocument,
  createScanSession,
  fetchCurrentSession,
  fetchIntegrationStatus,
  listAppointmentDocuments,
  prepareScanSession,
  uploadAppointmentDocument,
  type AppointmentRefType,
  type RequestDocument,
} from "@/lib/api-hooks";
import { scanAppointmentRequest } from "@/lib/naps2-webscan";
import { pushToast } from "@/lib/toast";
import { DocumentPreviewWorkspace } from "./document-preview-workspace";

export type DocumentPreviewMode = "link" | "modal" | "inline";

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

interface RequestDocumentsPanelProps {
  appointmentId: number;
  patientId: number | null;
  appointmentRefType?: AppointmentRefType;
  title?: string;
  previewMode?: DocumentPreviewMode;
  enableLocalScan?: boolean;
}

export function RequestDocumentsPanel({
  appointmentId,
  patientId,
  appointmentRefType = "auto",
  title,
  previewMode = "link",
  enableLocalScan = false,
}: RequestDocumentsPanelProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(null);
  const [selectedPreview, setSelectedPreview] = useState<RequestDocument | null>(null);
  const [scanUploading, setScanUploading] = useState(false);
  const [scannerAppLaunching, setScannerAppLaunching] = useState(false);
  const [lastScannerAppLaunchUrl, setLastScannerAppLaunchUrl] = useState("");
  const [showScannerAppFallback, setShowScannerAppFallback] = useState(false);
  const [retryingFailedUploads, setRetryingFailedUploads] = useState(false);
  const [failedScanUploads, setFailedScanUploads] = useState<Array<{ file: File; error: string; documentType: string }>>([]);
  const resolvedTitle = title ?? t("documents.title");
  const documentType = "appointment_request";

  const queryKey = useMemo(
    () => ["appointment-documents", appointmentRefType, appointmentId],
    [appointmentId, appointmentRefType]
  );
  const { data: documents = [], isLoading, error } = useQuery({
    queryKey,
    queryFn: () => listAppointmentDocuments(appointmentId, appointmentRefType),
    enabled: Number.isFinite(appointmentId) && appointmentId > 0,
  });
  const selectedDocument = useMemo(
    () => documents.find((document) => document.id === selectedDocumentId) ?? null,
    [documents, selectedDocumentId]
  );

  useEffect(() => {
    if (documents.length === 0) {
      if (selectedDocumentId !== null) setSelectedDocumentId(null);
      return;
    }
    if (selectedDocumentId !== null && documents.some((document) => document.id === selectedDocumentId)) return;
    setSelectedDocumentId(documents[0].id);
  }, [documents, selectedDocumentId]);
  const { data: currentUser } = useQuery({
    queryKey: ["current-session"],
    queryFn: fetchCurrentSession,
    staleTime: 60_000,
  });
  const { data: integrationStatus } = useQuery({
    queryKey: ["integration-status", "documents"],
    queryFn: fetchIntegrationStatus,
    enabled: enableLocalScan,
    staleTime: 60_000,
  });
  const canScanOrUpload =
    currentUser?.role === "receptionist" ||
    currentUser?.role === "supervisor" ||
    currentUser?.role === "super_admin";
  const canDelete = currentUser?.role === "supervisor" || currentUser?.role === "super_admin";
  const hasAppointmentContext = Number.isFinite(appointmentId) && appointmentId > 0 && Number.isFinite(patientId) && Number(patientId) > 0;
  const naps2ScannerEnabled =
    enableLocalScan &&
    canScanOrUpload &&
    hasAppointmentContext &&
    Boolean(
      integrationStatus?.scanner?.naps2WebScanEnabled ||
      integrationStatus?.scanner?.scannerBridgeMode === "naps2_webscan"
    );
  const scannerAppEnabled =
    enableLocalScan &&
    canScanOrUpload &&
    hasAppointmentContext &&
    Boolean(integrationStatus?.scanner) &&
    integrationStatus?.scanner?.scannerAppEnabled !== false;
  const scannerAppDownloadUrl =
    integrationStatus?.scanner?.scannerAppDownloadUrl || "/assets/downloads/RISproScannerSetup.msi";
  const scanDpi = Number(integrationStatus?.scanner?.scanDpi || 200);
  const scanColorMode = integrationStatus?.scanner?.scanColorMode === "color" ? "color" : "grayscale";
  const scanSource =
    integrationStatus?.scanner?.scannerSource === "flatbed"
      ? "flatbed"
      : integrationStatus?.scanner?.scannerSource === "duplex"
        ? "duplex"
        : "feeder";

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error(t("documents.chooseFileFirst"));
      return uploadFileAsDocument(file, documentType, "manual_upload");
    },
    onSuccess: (uploadedDocument) => {
      setFile(null);
      if (Number.isInteger(uploadedDocument.id) && uploadedDocument.id > 0) {
        setSelectedDocumentId(uploadedDocument.id);
      }
      queryClient.invalidateQueries({ queryKey });
      pushToast({
        type: "success",
        title: t("documents.uploadedTitle"),
        message: t("documents.uploadedMessage"),
      });
    },
    onError: (err: unknown) => {
      pushToast({
        type: "error",
        title: t("documents.uploadFailedTitle"),
        message: err instanceof Error ? err.message : t("documents.uploadFailedMessage"),
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (documentId: number) => deleteAppointmentDocument(documentId),
    onSuccess: (_result, documentId) => {
      if (selectedDocumentId === documentId) setSelectedDocumentId(null);
      if (selectedPreview?.id === documentId) setSelectedPreview(null);
      queryClient.invalidateQueries({ queryKey });
      pushToast({
        type: "success",
        title: t("documents.deletedTitle"),
        message: t("documents.deletedMessage"),
      });
    },
    onError: (err: unknown) => {
      pushToast({
        type: "error",
        title: t("documents.deleteFailedTitle"),
        message: err instanceof Error ? err.message : t("documents.deleteFailedMessage"),
      });
    },
  });

  async function uploadFileAsDocument(fileToUpload: File, normalizedDocumentType: string, source: "manual_upload" | "naps2_webscan") {
    const fileContentBase64 = await fileToBase64(fileToUpload);
    return uploadAppointmentDocument({
      patientId,
      appointmentId,
      appointmentRefType,
      documentType: normalizedDocumentType,
      originalFilename: fileToUpload.name,
      mimeType: fileToUpload.type || "application/octet-stream",
      fileContentBase64,
      source,
    });
  }

  function launchScannerApp(launchUrl: string) {
    setLastScannerAppLaunchUrl(launchUrl);
    setShowScannerAppFallback(true);
    try {
      window.location.href = launchUrl;
    } catch {
      // Browsers cannot reliably report custom protocol launch failures.
    }
  }

  async function handleLaunchScannerApp() {
    if (scannerAppLaunching || scanUploading || retryingFailedUploads || uploadMutation.isPending) return;
    if (!scannerAppEnabled) {
      pushToast({
        type: "error",
        title: t("documents.scanNotSupportedTitle"),
        message: t("documents.scanNotSupportedMessage"),
      });
      return;
    }

    setScannerAppLaunching(true);
    try {
      const response = await createScanSession({
        appointmentId,
        patientId,
        documentType,
        appointmentRefType,
      });
      launchScannerApp(response.launchUrl);
      pushToast({
        type: "success",
        title: t("documents.scannerAppLaunchTitle"),
        message: t("documents.scannerAppLaunchMessage"),
      });
    } catch (err) {
      pushToast({
        type: "error",
        title: t("documents.prepareFailedTitle"),
        message: err instanceof Error ? err.message : t("documents.prepareFailedMessage"),
      });
    } finally {
      setScannerAppLaunching(false);
    }
  }

  async function handleScanAndAttach() {
    if (scanUploading || retryingFailedUploads || uploadMutation.isPending) return;
    if (!naps2ScannerEnabled) {
      pushToast({
        type: "error",
        title: t("documents.scanNotSupportedTitle"),
        message: t("documents.scanNotSupportedMessage"),
      });
      return;
    }

    const normalizedDocumentType = documentType.trim() || "referral_request";
    setScanUploading(true);
    setFailedScanUploads([]);

    try {
      const preparationResponse = await prepareScanSession({
        appointmentId,
        patientId,
        documentType,
        appointmentRefType,
      });
      const preparation = (preparationResponse as { preparation?: Record<string, unknown> }).preparation;
      const preparedDocumentTypeRaw = preparation?.documentType;
      const preparedDocumentType =
        typeof preparedDocumentTypeRaw === "string" && preparedDocumentTypeRaw.trim()
          ? preparedDocumentTypeRaw.trim()
          : normalizedDocumentType;
      const suggestedFileNameRaw = preparation?.suggestedFileName;
      const suggestedFileName = typeof suggestedFileNameRaw === "string" ? suggestedFileNameRaw : undefined;
      const preparedSessionCode = typeof preparation?.sessionCode === "string" ? preparation.sessionCode : "";
      const preparedGuidance = typeof preparation?.guidance === "string" ? preparation.guidance : "";
      pushToast({
        type: "success",
        title: t("documents.scanPreparedTitle"),
        message: `${preparedSessionCode} ${preparedGuidance}`.trim(),
      });

      const failures: Array<{ file: File; error: string; documentType: string }> = [];
      const scanResult = await scanAppointmentRequest({
        endpoint: integrationStatus?.scanner?.naps2WebScanEndpoint,
        dpi: Number.isFinite(scanDpi) && scanDpi > 0 ? scanDpi : 200,
        colorMode: scanColorMode,
        source: scanSource,
        fileName: suggestedFileName || `appointment-${appointmentId}-request.pdf`,
      });
      try {
        const uploadedDocument = await uploadFileAsDocument(scanResult.file, preparedDocumentType, scanResult.source);
        if (Number.isInteger(uploadedDocument.id) && uploadedDocument.id > 0) {
          setSelectedDocumentId(uploadedDocument.id);
        }
      } catch (err) {
        failures.push({
          file: scanResult.file,
          error: err instanceof Error ? err.message : t("documents.uploadFailedMessage"),
          documentType: preparedDocumentType,
        });
      }

      if (failures.length === 0) {
        queryClient.invalidateQueries({ queryKey });
        pushToast({
          type: "success",
          title: t("documents.scanUploadedTitle"),
          message: t("documents.scanUploadedMessage"),
        });
      }

      if (failures.length > 0) {
        setFailedScanUploads(failures);
        pushToast({
          type: "error",
          title: t("documents.scanPartialFailedTitle"),
          message: t("documents.scanPartialFailedMessage"),
        });
      }
    } catch (err) {
      pushToast({
        type: "error",
        title: t("documents.scanFailedTitle"),
        message: err instanceof Error ? err.message : t("documents.scanFailedMessage"),
      });
    } finally {
      setScanUploading(false);
    }
  }

  async function handleRetryFailedUploads() {
    if (scanUploading || retryingFailedUploads || failedScanUploads.length === 0) return;
    setRetryingFailedUploads(true);
    const remainingFailures: Array<{ file: File; error: string; documentType: string }> = [];
    let retriedSuccessCount = 0;

    try {
      for (const failedUpload of failedScanUploads) {
        try {
          const uploadedDocument = await uploadFileAsDocument(failedUpload.file, failedUpload.documentType, "naps2_webscan");
          if (Number.isInteger(uploadedDocument.id) && uploadedDocument.id > 0) {
            setSelectedDocumentId(uploadedDocument.id);
          }
          retriedSuccessCount += 1;
        } catch (err) {
          remainingFailures.push({
            file: failedUpload.file,
            error: err instanceof Error ? err.message : t("documents.uploadFailedMessage"),
            documentType: failedUpload.documentType,
          });
        }
      }

      setFailedScanUploads(remainingFailures);
      if (retriedSuccessCount > 0) {
        queryClient.invalidateQueries({ queryKey });
        pushToast({
          type: "success",
          title: t("documents.retryUploadedTitle"),
          message: t("documents.retryUploadedMessage"),
        });
      }

      if (remainingFailures.length > 0) {
        pushToast({
          type: "error",
          title: t("documents.retryFailedTitle"),
          message: t("documents.retryFailedMessage"),
        });
      }
    } finally {
      setRetryingFailedUploads(false);
    }
  }

  return (
    <div className={previewMode === "inline" ? "flex h-full min-h-0 flex-col rounded-xl border border-stone-200 p-3 dark:border-stone-700" : "rounded-xl border border-stone-200 p-4 dark:border-stone-700"}>
      <div className="flex shrink-0 items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-stone-900 dark:text-white">{resolvedTitle}</h4>
      </div>

      <div className="mt-3 grid shrink-0 grid-cols-1 gap-2 md:grid-cols-3">
        <input
          data-testid="document-file-input"
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="input-premium"
        />
        <div className="flex gap-2">
          {scannerAppEnabled && (
            <button
              type="button"
              onClick={handleLaunchScannerApp}
              className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm"
              disabled={scannerAppLaunching || scanUploading || retryingFailedUploads || uploadMutation.isPending}
            >
              {scannerAppLaunching ? t("documents.preparing") : t("documents.scanPaper")}
            </button>
          )}
          {!scannerAppEnabled && naps2ScannerEnabled && (
            <button
              type="button"
              onClick={handleScanAndAttach}
              className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-sm"
              disabled={scanUploading || retryingFailedUploads || uploadMutation.isPending}
            >
              {scanUploading ? t("documents.scanning") : t("documents.scanAppointmentRequest")}
            </button>
          )}
          <button
            type="button"
            onClick={() => uploadMutation.mutate()}
            className="px-3 py-2 rounded-lg bg-teal-600 text-white text-sm"
            disabled={!file || uploadMutation.isPending || scanUploading || retryingFailedUploads || !canScanOrUpload}
          >
            {uploadMutation.isPending ? t("documents.uploading") : t("documents.attachRequest")}
          </button>
        </div>
      </div>
      {enableLocalScan && canScanOrUpload && !naps2ScannerEnabled && (
        <p className="mt-2 shrink-0 text-xs text-stone-500">{t("documents.scanNotSupportedMessage")}</p>
      )}

      {enableLocalScan && canScanOrUpload && (
        <div className="mt-2 flex shrink-0 flex-wrap items-center gap-2 text-xs text-stone-500">
          {scannerAppEnabled ? (
            <>
              <a href={scannerAppDownloadUrl} className="underline" download>
                {t("documents.downloadScannerApp")}
              </a>
              {showScannerAppFallback && (
                <>
                  <span>{t("documents.scannerAppFallbackMessage")}</span>
                  <button
                    type="button"
                    className="underline"
                    onClick={() => {
                      if (lastScannerAppLaunchUrl) launchScannerApp(lastScannerAppLaunchUrl);
                    }}
                  >
                    {t("documents.retryLaunchScannerApp")}
                  </button>
                  {naps2ScannerEnabled && (
                    <button
                      type="button"
                      className="underline"
                      onClick={handleScanAndAttach}
                      disabled={scanUploading || retryingFailedUploads || uploadMutation.isPending}
                    >
                      {scanUploading ? t("documents.scanning") : t("documents.useNaps2WebScan")}
                    </button>
                  )}
                </>
              )}
            </>
          ) : naps2ScannerEnabled ? (
            <button
              type="button"
              className="underline"
              onClick={handleScanAndAttach}
              disabled={scanUploading || retryingFailedUploads || uploadMutation.isPending}
            >
              {scanUploading ? t("documents.scanning") : t("documents.useNaps2WebScan")}
            </button>
          ) : null}
        </div>
      )}

      {failedScanUploads.length > 0 && (
        <div className="mt-2 shrink-0 space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-900/20">
          <div className="text-xs text-amber-800 dark:text-amber-200">
            {t("documents.failedUploadsRemaining")}: {failedScanUploads.length}
          </div>
          <button
            type="button"
            onClick={handleRetryFailedUploads}
            className="px-3 py-2 rounded-lg bg-amber-600 text-white text-sm"
            disabled={retryingFailedUploads || scanUploading}
          >
            {retryingFailedUploads ? t("documents.retryingFailedUploads") : t("documents.retryFailedUploads")}
          </button>
        </div>
      )}

      {isLoading ? (
        <p className="mt-3 text-sm text-stone-500" role="status">{t("documents.loading")}</p>
      ) : error ? (
        <p className="mt-3 text-sm text-red-600" role="alert">{error instanceof Error ? error.message : t("documents.failedLoad")}</p>
      ) : documents.length === 0 ? (
        <p className="mt-3 text-sm text-stone-500">{t("documents.noDocuments")}</p>
      ) : previewMode === "inline" ? (
        <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex shrink-0 gap-2 overflow-x-auto pb-1" role="list" aria-label={t("documents.documentSelector")}>
            {documents.map((doc) => (
              <div key={doc.id} className="flex shrink-0 items-center gap-1 rounded-lg border border-border bg-muted/20 p-1" role="listitem">
                <button
                  type="button"
                  className={`max-w-48 truncate rounded-md px-2 py-1.5 text-start text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${selectedDocumentId === doc.id ? "bg-accent/10 font-semibold text-foreground" : "text-muted-foreground hover:bg-muted"}`}
                  onClick={() => setSelectedDocumentId(doc.id)}
                  aria-pressed={selectedDocumentId === doc.id}
                  title={doc.originalFilename}
                >
                  {doc.originalFilename}
                </button>
                {canDelete ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (!window.confirm(t("documents.deleteConfirm"))) return;
                      deleteMutation.mutate(doc.id);
                    }}
                    className="rounded-md bg-red-100 px-2 py-1.5 text-xs text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:bg-red-900/30 dark:text-red-400"
                    disabled={deleteMutation.isPending}
                  >
                    {t("documents.delete")}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          {selectedDocument ? <DocumentPreviewWorkspace document={selectedDocument} /> : null}
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {documents.map((doc) => (
            <li key={doc.id} className="rounded-lg border border-stone-200 p-2 dark:border-stone-700">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-stone-900 dark:text-white">{doc.originalFilename}</div>
                  <div className="text-xs text-stone-500">
                    {doc.documentType} - {doc.mimeType || "file"} - {doc.storageLocationType}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {previewMode === "modal" ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedDocumentId(doc.id);
                        setSelectedPreview(doc);
                      }}
                      className="rounded bg-stone-100 px-2 py-1 text-xs dark:bg-stone-700"
                    >
                      {t("documents.view")}
                    </button>
                  ) : (
                    <a
                      href={`/api/documents/${doc.id}/view`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded bg-stone-100 px-2 py-1 text-xs dark:bg-stone-700"
                    >
                      {t("documents.open")}
                    </a>
                  )}
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => {
                        if (!window.confirm(t("documents.deleteConfirm"))) return;
                        deleteMutation.mutate(doc.id);
                      }}
                      className="rounded bg-red-100 px-2 py-1 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-400"
                      disabled={deleteMutation.isPending}
                    >
                      {t("documents.delete")}
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {previewMode === "modal" && selectedPreview && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelectedPreview(null);
          }}
        >
          <div className="bg-white dark:bg-stone-900 rounded-xl w-full max-w-5xl h-[80vh] flex flex-col">
            <div className="p-3 border-b border-stone-200 dark:border-stone-700 flex items-center justify-between">
              <div className="text-sm font-semibold">{selectedPreview.originalFilename}</div>
              <div className="flex gap-2">
                <a
                  href={`/api/documents/${selectedPreview.id}/view`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2 py-1 text-xs rounded bg-stone-100 dark:bg-stone-700"
                >
                  {t("documents.openInNewTab")}
                </a>
                <button
                  type="button"
                  onClick={() => setSelectedPreview(null)}
                  className="px-2 py-1 text-xs rounded bg-stone-100 dark:bg-stone-700"
                >
                  {t("documents.close")}
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden p-3">
              <DocumentPreviewWorkspace document={selectedPreview} showOpenAction={false} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
