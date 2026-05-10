import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLanguage } from "@/providers/language-provider";
import {
  deleteAppointmentDocument,
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
  enablePreviewModal?: boolean;
  enableLocalScan?: boolean;
}

export function RequestDocumentsPanel({
  appointmentId,
  patientId,
  appointmentRefType = "auto",
  title,
  enablePreviewModal = false,
  enableLocalScan = false,
}: RequestDocumentsPanelProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [selectedPreview, setSelectedPreview] = useState<RequestDocument | null>(null);
  const [scanUploading, setScanUploading] = useState(false);
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
    Boolean(integrationStatus?.scanner?.naps2WebScanEnabled || integrationStatus?.scanner?.scannerBridgeMode === "naps2_webscan");

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error(t("documents.chooseFileFirst"));
      return uploadFileAsDocument(file, documentType, "manual_upload");
    },
    onSuccess: () => {
      setFile(null);
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
    onSuccess: () => {
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
        dpi: 200,
        colorMode: "grayscale",
        source: "feeder",
        fileName: suggestedFileName || `appointment-${appointmentId}-request.pdf`,
      });
      try {
        await uploadFileAsDocument(scanResult.file, preparedDocumentType, scanResult.source);
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
          await uploadFileAsDocument(failedUpload.file, failedUpload.documentType, "naps2_webscan");
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
    <div className="rounded-xl border border-stone-200 dark:border-stone-700 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-stone-900 dark:text-white">{resolvedTitle}</h4>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="input-premium"
        />
        <div className="flex gap-2">
          {naps2ScannerEnabled && (
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
        <p className="text-xs text-stone-500">{t("documents.scanNotSupportedMessage")}</p>
      )}

      {failedScanUploads.length > 0 && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 space-y-2">
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
        <p className="text-sm text-stone-500">{t("documents.loading")}</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error instanceof Error ? error.message : t("documents.failedLoad")}</p>
      ) : documents.length === 0 ? (
        <p className="text-sm text-stone-500">{t("documents.noDocuments")}</p>
      ) : (
        <ul className="space-y-2">
          {documents.map((doc) => (
            <li key={doc.id} className="rounded-lg border border-stone-200 dark:border-stone-700 p-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-stone-900 dark:text-white truncate">{doc.originalFilename}</div>
                  <div className="text-xs text-stone-500">
                    {doc.documentType} - {doc.mimeType || "file"} - {doc.storageLocationType}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {enablePreviewModal ? (
                    <button
                      type="button"
                      onClick={() => setSelectedPreview(doc)}
                      className="px-2 py-1 text-xs rounded bg-stone-100 dark:bg-stone-700"
                    >
                      {t("documents.view")}
                    </button>
                  ) : (
                    <a
                      href={`/api/documents/${doc.id}/view`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2 py-1 text-xs rounded bg-stone-100 dark:bg-stone-700"
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
                      className="px-2 py-1 text-xs rounded bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
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

      {enablePreviewModal && selectedPreview && (
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
            <iframe
              title={`doc-${selectedPreview.id}`}
              src={`/api/documents/${selectedPreview.id}/view`}
              className="w-full h-full"
            />
          </div>
        </div>
      )}
    </div>
  );
}
