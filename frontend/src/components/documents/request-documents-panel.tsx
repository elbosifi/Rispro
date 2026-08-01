import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, FileImage, FileText, Loader2, MoreVertical, MousePointer2, Pencil, Printer, Redo2, Save as SaveIcon, ScanLine, Square, Trash2, Type, Undo2, Upload } from "lucide-react";
import { useLanguage } from "@/providers/language-provider";
import {
  deleteAppointmentDocument,
  createScanSession,
  fetchCurrentSession,
  fetchIntegrationStatus,
  listAppointmentDocuments,
  prepareScanSession,
  uploadAppointmentDocument,
  createProtocolDocumentAnnotation,
  deleteProtocolDocumentAnnotation,
  listProtocolDocumentAnnotations,
  updateProtocolDocumentAnnotation,
  type AppointmentRefType,
  type RequestDocument,
} from "@/lib/api-hooks";
import type { ProtocolDocumentAnnotation, ProtocolDocumentAnnotationType } from "@/types/api";
import type { AnnotationTool } from "./document-annotation-overlay";
import { scanAppointmentRequest } from "@/lib/naps2-webscan";
import { pushToast } from "@/lib/toast";
import { DocumentPreviewWorkspace } from "./document-preview-workspace";
import { directPrint } from "@/services/printing/direct-print-service";
import { resolveDirectPrintFailureAction } from "@/services/printing/direct-print-failure-action";
import { loadQzPrinterSettings } from "@/services/printing/workstation-printer-settings";
import type { PrinterDocumentType } from "@/types/printing";

export type DocumentPreviewMode = "link" | "modal" | "inline";
const EMPTY_ANNOTATIONS: ProtocolDocumentAnnotation[] = [];

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
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  layout?: "default" | "workspace";
  supplementaryPanel?: ReactNode;
  enableAnnotations?: boolean;
  onAnnotationDirtyChange?: (dirty: boolean) => void;
}

export function RequestDocumentsPanel({
  appointmentId,
  patientId,
  appointmentRefType = "auto",
  title,
  previewMode = "link",
  enableLocalScan = false,
  expanded = false,
  onExpandedChange,
  layout = "default",
  supplementaryPanel,
  enableAnnotations = false,
  onAnnotationDirtyChange,
}: RequestDocumentsPanelProps) {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(null);
  const [selectedPreview, setSelectedPreview] = useState<RequestDocument | null>(null);
  const [fileMenuDocumentId, setFileMenuDocumentId] = useState<number | null>(null);
  const [scanUploading, setScanUploading] = useState(false);
  const [scannerAppLaunching, setScannerAppLaunching] = useState(false);
  const [lastScannerAppLaunchUrl, setLastScannerAppLaunchUrl] = useState("");
  const [showScannerAppFallback, setShowScannerAppFallback] = useState(false);
  const [retryingFailedUploads, setRetryingFailedUploads] = useState(false);
  const [failedScanUploads, setFailedScanUploads] = useState<Array<{ file: File; error: string; documentType: string }>>([]);
  const [documentRailCollapsed, setDocumentRailCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [printingDocumentId, setPrintingDocumentId] = useState<number | null>(null);
  const resolvedTitle = title ?? t("documents.title");
  const documentType = "appointment_request";

  async function printPdfDocument(document: RequestDocument, profile: Extract<PrinterDocumentType, "A4_DOCUMENT" | "A5_DOCUMENT">) {
    if (printingDocumentId != null) return;
    setPrintingDocumentId(document.id);
    try {
      const result = await directPrint({ documentType: profile, documentId: String(document.id), appointmentId });
      if (result.success) {
        pushToast({ type: "success", title: "Print job submitted", message: `Print job sent to ${result.printerName}.` });
        return;
      }
      const settings = loadQzPrinterSettings();
      const action = resolveDirectPrintFailureAction(result.errorCode, true, settings.browserPrintFallbackEnabled);
      const toastAction = action === "OPEN_SETTINGS"
        ? { label: "Open Printing settings", onClick: () => window.location.assign("/workstation/printing") }
        : action === "BROWSER_PRINT"
          ? { label: "Use browser printing", onClick: () => window.open(`/api/documents/${document.id}/view`, "_blank", "noopener,noreferrer") }
          : null;
      pushToast({
        type: "error",
        title: "Document print failed",
        message: result.message,
        ...(toastAction ? { action: toastAction } : {}),
      }, 10_000);
    } finally {
      setPrintingDocumentId(null);
      setFileMenuDocumentId(null);
    }
  }

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

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
  const [annotations, setAnnotations] = useState<ProtocolDocumentAnnotation[]>([]);
  const [savedAnnotationIds, setSavedAnnotationIds] = useState<Set<number>>(new Set());
  const [deletedAnnotationIds, setDeletedAnnotationIds] = useState<number[]>([]);
  const [annotationTool, setAnnotationTool] = useState<AnnotationTool>("select");
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<number | null>(null);
  type AnnotationHistory = { annotations: ProtocolDocumentAnnotation[]; deletedAnnotationIds: number[] };
  const [annotationPast, setAnnotationPast] = useState<AnnotationHistory[]>([]);
  const [annotationFuture, setAnnotationFuture] = useState<AnnotationHistory[]>([]);
  const [annotationSaving, setAnnotationSaving] = useState(false);
  const { data: loadedAnnotations = EMPTY_ANNOTATIONS, refetch: refetchAnnotations } = useQuery({
    queryKey: ["doctor", "protocol-document-annotations", selectedDocument?.id],
    queryFn: () => listProtocolDocumentAnnotations(selectedDocument!.id),
    enabled: enableAnnotations && Boolean(selectedDocument?.id),
  });

  useEffect(() => {
    if (!enableAnnotations) return;
    setAnnotations(loadedAnnotations);
    setSavedAnnotationIds(new Set(loadedAnnotations.map((annotation) => annotation.id)));
    setDeletedAnnotationIds([]);
    setSelectedAnnotationId(null);
    setAnnotationPast([]);
    setAnnotationFuture([]);
  }, [enableAnnotations, loadedAnnotations, selectedDocument?.id]);

  const annotationDirty = deletedAnnotationIds.length > 0 || annotations.some((annotation) => !savedAnnotationIds.has(annotation.id));
  useEffect(() => onAnnotationDirtyChange?.(annotationDirty), [annotationDirty, onAnnotationDirtyChange]);
  const changeAnnotations = (next: ProtocolDocumentAnnotation[], nextDeletedAnnotationIds = deletedAnnotationIds) => {
    setAnnotationPast((current) => [...current.slice(-19), { annotations, deletedAnnotationIds }]);
    setAnnotationFuture([]);
    setAnnotations(next);
    setDeletedAnnotationIds(nextDeletedAnnotationIds);
  };
  const saveAnnotations = async () => {
    if (annotationSaving || !selectedDocument) return;
    setAnnotationSaving(true);
    let workingAnnotations = annotations;
    try {
      for (const annotation of annotations) {
        const payload = { pageNumber: annotation.pageNumber, annotationType: annotation.annotationType, geometry: annotation.geometry, textContent: annotation.textContent, style: annotation.style };
        const persisted = annotation.id < 0
          ? await createProtocolDocumentAnnotation(selectedDocument.id, payload)
          : await updateProtocolDocumentAnnotation(selectedDocument.id, annotation.id, payload);
        workingAnnotations = workingAnnotations.map((current) => current.id === annotation.id ? persisted : current);
        setAnnotations(workingAnnotations);
      }
      for (const id of deletedAnnotationIds) {
        await deleteProtocolDocumentAnnotation(selectedDocument.id, id);
        workingAnnotations = workingAnnotations.filter((annotation) => annotation.id !== id);
        setAnnotations(workingAnnotations);
      }
      const refreshed = await refetchAnnotations();
      if (refreshed.error) throw refreshed.error;
      const reloaded = refreshed.data ?? [];
      setAnnotations(reloaded);
      setSavedAnnotationIds(new Set(reloaded.map((annotation) => annotation.id)));
      setDeletedAnnotationIds([]);
      setSelectedAnnotationId((current) => reloaded.some((annotation) => annotation.id === current) ? current : null);
      pushToast({ type: "success", title: "Annotations saved", message: "Document annotations were saved successfully." });
    } catch (error) {
      pushToast({ type: "error", title: "Annotation save failed", message: error instanceof Error ? error.message : "Document annotations could not be saved." });
    } finally {
      setAnnotationSaving(false);
    }
  };
  const annotationToolIcon = (tool: AnnotationTool) => {
    if (tool === "select") return <MousePointer2 size={14} aria-hidden="true" />;
    if (tool === "arrow") return <ArrowUpRight size={14} aria-hidden="true" />;
    if (tool === "rectangle") return <Square size={14} aria-hidden="true" />;
    if (tool === "freehand") return <Pencil size={14} aria-hidden="true" />;
    return <Type size={14} aria-hidden="true" />;
  };
  const annotationToolLabel = (tool: AnnotationTool) => tool === "freehand" ? "Pen" : tool[0]!.toUpperCase() + tool.slice(1);
  const annotationToolbar = enableAnnotations ? (
    <div className="flex min-w-0 max-w-full items-center gap-0.5 overflow-x-auto" role="group" aria-label="Document annotation tools">
      {(["select", "arrow", "rectangle", "freehand", "text"] as AnnotationTool[]).map((tool) => <button key={tool} type="button" className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded ${annotationTool === tool ? "bg-accent/10 text-accent" : "text-muted-foreground hover:bg-muted"}`} onClick={() => setAnnotationTool(tool)} aria-label={annotationToolLabel(tool)} title={annotationToolLabel(tool)} aria-pressed={annotationTool === tool}>{annotationToolIcon(tool)}</button>)}
       <button type="button" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-40" disabled={selectedAnnotationId === null} onClick={() => { const selected = annotations.find((annotation) => annotation.id === selectedAnnotationId); if (!selected) return; changeAnnotations(annotations.filter((annotation) => annotation.id !== selected.id), selected.id > 0 ? [...new Set([...deletedAnnotationIds, selected.id])] : deletedAnnotationIds); setSelectedAnnotationId(null); }} aria-label="Delete selected annotation" title="Delete selected annotation"><Trash2 size={14} aria-hidden="true" /></button>
       <button type="button" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-40" disabled={annotations.length === 0} onClick={() => { if (!window.confirm("Clear all annotations from this document? This will be applied when annotations are saved.")) return; changeAnnotations([], [...new Set([...deletedAnnotationIds, ...annotations.filter((annotation) => annotation.id > 0).map((annotation) => annotation.id)])]); setSelectedAnnotationId(null); }} aria-label="Clear all annotations" title="Clear all annotations"><Trash2 size={14} aria-hidden="true" /></button>
       <button type="button" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-40" disabled={annotationPast.length === 0} onClick={() => { const previous = annotationPast.at(-1); if (!previous) return; setAnnotationPast((current) => current.slice(0, -1)); setAnnotationFuture((current) => [...current, { annotations, deletedAnnotationIds }]); setAnnotations(previous.annotations); setDeletedAnnotationIds(previous.deletedAnnotationIds); setSelectedAnnotationId(null); }} aria-label="Undo annotation change" title="Undo"><Undo2 size={14} aria-hidden="true" /></button>
       <button type="button" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted disabled:opacity-40" disabled={annotationFuture.length === 0} onClick={() => { const next = annotationFuture.at(-1); if (!next) return; setAnnotationFuture((current) => current.slice(0, -1)); setAnnotationPast((current) => [...current, { annotations, deletedAnnotationIds }]); setAnnotations(next.annotations); setDeletedAnnotationIds(next.deletedAnnotationIds); setSelectedAnnotationId(null); }} aria-label="Redo annotation change" title="Redo"><Redo2 size={14} aria-hidden="true" /></button>
      <button type="button" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded bg-teal-700 text-white disabled:opacity-40" disabled={!annotationDirty || !selectedDocument || annotationSaving} onClick={() => void saveAnnotations()} aria-label={annotationSaving ? "Saving annotations" : "Save annotations"} title={annotationSaving ? "Saving annotations" : "Save annotations"}><SaveIcon size={14} aria-hidden="true" /></button>
      {annotationDirty ? <span className="shrink-0 px-1 text-[10px] font-semibold text-amber-700">Unsaved</span> : null}
    </div>
  ) : null;
  const createAnnotation = (input: { pageNumber: number; annotationType: ProtocolDocumentAnnotationType; geometry: Record<string, unknown>; textContent?: string | null }) => {
    const temporaryId = -Date.now();
    changeAnnotations([...annotations, { id: temporaryId, documentId: selectedDocument?.id ?? 0, pageNumber: input.pageNumber, annotationType: input.annotationType, geometry: input.geometry, textContent: input.textContent ?? null, style: { color: "#0f766e" }, createdByUserId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]);
    setSelectedAnnotationId(temporaryId);
  };

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

  const deleteDocument = (documentId: number) => {
    if (!window.confirm(t("documents.deleteConfirm"))) return;
    deleteMutation.mutate(documentId);
  };

  const formatFileSize = (bytes: number) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return "—";
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const scanControlsContent = (
    <section id="request-documents-scan-upload" className="rounded-xl border border-border bg-background p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t("documents.scanAndAttach")}</h3>
          <p className="mt-1 text-[11px] text-muted-foreground">PDF, JPG, PNG</p>
        </div>
        <ScanLine size={18} className="text-accent" aria-hidden="true" />
      </div>
      <div className="flex flex-col gap-2">
        {scannerAppEnabled && (layout !== "workspace" || !isMobile) ? (
          <button
            type="button"
            onClick={handleLaunchScannerApp}
            className="order-2 inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={scannerAppLaunching || scanUploading || retryingFailedUploads || uploadMutation.isPending}
          >
            <ScanLine size={15} aria-hidden="true" />
            {scannerAppLaunching ? t("documents.preparing") : t("documents.scanPaper")}
          </button>
        ) : null}
        {!scannerAppEnabled && naps2ScannerEnabled && (layout !== "workspace" || !isMobile) ? (
          <button
            type="button"
            onClick={handleScanAndAttach}
            className="order-2 inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={scanUploading || retryingFailedUploads || uploadMutation.isPending}
          >
            <ScanLine size={15} aria-hidden="true" />
            {scanUploading ? t("documents.scanning") : t("documents.scanAppointmentRequest")}
          </button>
        ) : null}
        <label htmlFor="request-documents-upload-file" className="order-0 inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground transition hover:opacity-90 focus-within:outline-none focus-within:ring-2 focus-within:ring-accent/50">
          <Upload size={15} aria-hidden="true" />
          <span dir="ltr">{file ? `${file.name} · ${formatFileSize(file.size)}` : t("documents.uploadRequest")}</span>
        </label>
        <input
          id="request-documents-upload-file"
          data-testid="document-file-input"
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          onChange={(event) => setFile(event.target.files?.[0] || null)}
          className="sr-only"
        />
        <button
          type="button"
          onClick={() => uploadMutation.mutate()}
          className="order-0 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs font-semibold text-accent transition hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!file || uploadMutation.isPending || scanUploading || retryingFailedUploads || !canScanOrUpload}
        >
          <Upload size={15} aria-hidden="true" />
          {uploadMutation.isPending ? t("documents.uploading") : t("documents.attachRequest")}
        </button>
      </div>
      {!naps2ScannerEnabled && canScanOrUpload ? <p className="mt-2 text-[11px] text-muted-foreground">{t("documents.scanNotSupportedMessage")}</p> : null}
      {enableLocalScan && canScanOrUpload && (layout !== "workspace" || !isMobile) ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          {scannerAppEnabled ? <a href={scannerAppDownloadUrl} className="underline" download>{t("documents.downloadScannerApp")}</a> : null}
          {showScannerAppFallback ? <button type="button" className="underline" onClick={() => lastScannerAppLaunchUrl && launchScannerApp(lastScannerAppLaunchUrl)}>{t("documents.retryLaunchScannerApp")}</button> : null}
          {naps2ScannerEnabled ? <button type="button" className="underline" onClick={handleScanAndAttach} disabled={scanUploading || retryingFailedUploads || uploadMutation.isPending}>{t("documents.useNaps2WebScan")}</button> : null}
        </div>
      ) : null}
      {failedScanUploads.length > 0 ? (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
          <p>{t("documents.failedUploadsRemaining")}: {failedScanUploads.length}</p>
          <button type="button" className="mt-2 rounded-md bg-amber-600 px-2.5 py-1.5 font-semibold text-white disabled:opacity-50" onClick={handleRetryFailedUploads} disabled={retryingFailedUploads || scanUploading}>
            {retryingFailedUploads ? t("documents.retryingFailedUploads") : t("documents.retryFailedUploads")}
          </button>
        </div>
      ) : null}
    </section>
  );

  const scanControls = layout === "workspace" ? null : scanControlsContent;

  if (layout === "workspace") {
    return (
      <div data-expanded={expanded ? "true" : "false"} data-layout="appointment-workspace" data-testid="appointment-document-workspace" className="flex h-full min-h-0 min-w-0 flex-col">
        <div className={`grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-2 ${documentRailCollapsed ? "lg:grid-cols-[minmax(0,1fr)_44px]" : "lg:grid-cols-[minmax(0,1fr)_minmax(140px,180px)]"}`}>
          <section className="flex min-h-0 min-w-0 flex-col rounded-xl border border-border bg-background p-1 sm:p-1.5" aria-label={resolvedTitle}>
            <div className="flex min-h-0 flex-1 flex-col">
              {isLoading ? <div className="flex min-h-48 flex-1 items-center justify-center text-sm text-muted-foreground" role="status">{t("documents.loading")}</div> : null}
              {error ? <div className="flex min-h-48 flex-1 items-center justify-center rounded-lg border border-red-200 bg-red-50 p-4 text-center text-sm text-red-700" role="alert">{error instanceof Error ? error.message : t("documents.failedLoad")}</div> : null}
              {!isLoading && !error && !selectedDocument ? (
                <div className="flex min-h-64 flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/10 p-6 text-center">
                  <FileText size={30} className="mb-3 text-muted-foreground" aria-hidden="true" />
                  <p className="text-sm font-semibold text-foreground">{t("documents.noDocuments")}</p>
                  <p className="mt-1 max-w-sm text-xs text-muted-foreground">{!canScanOrUpload ? t("documents.emptyNoPermission") : t("documents.emptyUploadHint")}</p>
                  {canScanOrUpload ? <div className="mt-4 w-full max-w-sm">{scanControlsContent}</div> : null}
                </div>
              ) : null}
              {selectedDocument ? <DocumentPreviewWorkspace document={selectedDocument} expanded={expanded} onExpandedChange={onExpandedChange} preferSinglePage annotationToolbar={annotationToolbar} annotations={annotations} annotationTool={annotationTool} selectedAnnotationId={selectedAnnotationId} onSelectAnnotation={setSelectedAnnotationId} onCreateAnnotation={createAnnotation} /> : null}
            </div>
          </section>

          {documentRailCollapsed ? (
            <aside className="flex min-h-0 flex-col items-center rounded-xl border border-border bg-background p-1.5" aria-label="Document rail">
              <button type="button" className="rounded-md p-2 text-muted-foreground hover:bg-muted" onClick={() => setDocumentRailCollapsed(false)} aria-label="Expand document rail" title="Expand document rail"><ChevronLeft size={16} aria-hidden="true" /></button>
              <span className="mt-2 text-[10px] font-semibold text-muted-foreground [writing-mode:vertical-rl]">{t("documents.documentSelector")}</span>
            </aside>
          ) : <aside className="min-h-0 space-y-3 overflow-y-auto pb-20 lg:pb-0" aria-label={t("documents.documentSelector")} data-testid="document-rail">
            {layout === "workspace" ? null : (isMobile ? (canScanOrUpload ? <section className="rounded-xl border border-border bg-background p-3"><label htmlFor="request-documents-upload-file" className="inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground focus-within:outline-none focus-within:ring-2 focus-within:ring-accent/50"><Upload size={15} aria-hidden="true" /><span dir="ltr">{file ? `${file.name} · ${formatFileSize(file.size)}` : t("documents.uploadRequest")}</span></label><input id="request-documents-upload-file" data-testid="document-file-input" type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => setFile(event.target.files?.[0] || null)} className="sr-only" /><button type="button" onClick={() => uploadMutation.mutate()} className="mt-2 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2 text-xs font-semibold text-accent disabled:opacity-50" disabled={!file || uploadMutation.isPending || !canScanOrUpload}>{uploadMutation.isPending ? t("documents.uploading") : t("documents.attachRequest")}</button></section> : null) : canScanOrUpload ? scanControls : null)}
            <section className="rounded-xl border border-border bg-background p-2">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="truncate text-xs font-semibold text-foreground">{t("documents.documentSelector")}</h3>
                <button type="button" className="rounded-md p-1 text-muted-foreground hover:bg-muted" onClick={() => setDocumentRailCollapsed(true)} aria-label="Collapse document rail" title="Collapse document rail"><ChevronRight size={14} aria-hidden="true" /></button>
              </div>
              <span className="block text-[10px] text-muted-foreground">{documents.length} {documents.length === 1 ? "document" : "documents"}</span>
              {canScanOrUpload && documents.length > 0 ? <>
                <label htmlFor="request-documents-upload-file" className="mt-2 inline-flex min-h-8 w-full cursor-pointer items-center justify-center gap-1 rounded-md border border-accent/30 bg-accent/5 px-2 py-1.5 text-[11px] font-semibold text-accent focus-within:outline-none focus-within:ring-2 focus-within:ring-accent/50"><Upload size={13} aria-hidden="true" />{t("documents.uploadRequest")}</label>
                <button type="button" onClick={() => uploadMutation.mutate()} className="mt-1.5 inline-flex min-h-8 w-full items-center justify-center rounded-md bg-accent px-2 py-1.5 text-[11px] font-semibold text-accent-foreground disabled:opacity-50" disabled={!file || uploadMutation.isPending || scanUploading || retryingFailedUploads}>{uploadMutation.isPending ? t("documents.uploading") : t("documents.attachRequest")}</button>
                {!isMobile && scannerAppEnabled ? <button type="button" onClick={handleLaunchScannerApp} disabled={scannerAppLaunching || scanUploading || retryingFailedUploads || uploadMutation.isPending} className="mt-1.5 inline-flex min-h-8 w-full items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-[11px] font-semibold disabled:opacity-50" style={{ borderColor: "var(--border)" }}><ScanLine size={13} aria-hidden="true" />{scannerAppLaunching ? t("documents.preparing") : t("documents.scanPaper")}</button> : null}
                {!isMobile && !scannerAppEnabled && naps2ScannerEnabled ? <button type="button" onClick={handleScanAndAttach} disabled={scanUploading || retryingFailedUploads || uploadMutation.isPending} className="mt-1.5 inline-flex min-h-8 w-full items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-[11px] font-semibold disabled:opacity-50" style={{ borderColor: "var(--border)" }}><ScanLine size={13} aria-hidden="true" />{scanUploading ? t("documents.scanning") : t("documents.scanAppointmentRequest")}</button> : null}
              </> : null}
              {documents.length === 0 ? null : (
                <div className="space-y-2">
                  {documents.map((doc) => {
                    const isSelected = doc.id === selectedDocumentId;
                    const isPdf = doc.mimeType.toLowerCase() === "application/pdf" || doc.originalFilename.toLowerCase().endsWith(".pdf");
                    return (
                      <div key={doc.id} className={`relative rounded-lg border p-2 transition ${isSelected ? "border-accent bg-accent/5" : "border-border bg-muted/10"}`}>
                        <div className="flex items-start gap-2">
                          <button type="button" className="min-w-0 flex-1 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50" onClick={() => setSelectedDocumentId(doc.id)} aria-pressed={isSelected}>
                            <span className="mb-1 flex h-12 items-center justify-center overflow-hidden rounded border border-border bg-muted/10">{isPdf ? <FileText size={22} className="text-red-500" aria-hidden="true" /> : <img src={`/api/documents/${doc.id}/view`} alt="" className="h-full w-full object-contain" />}</span>
                            <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground"><span dir="ltr" className="truncate" title={doc.originalFilename}>{isPdf ? <FileText size={14} className="shrink-0 text-red-500" aria-hidden="true" /> : <FileImage size={14} className="shrink-0 text-emerald-500" aria-hidden="true" />}{doc.originalFilename}</span></span>
                            <span className="mt-1 block text-[10px] text-muted-foreground">{doc.pageCount ? `${doc.pageCount} ${t("documents.pagesCount").replace("{count}", "").trim()}` : doc.mimeType || "file"} · {formatFileSize(doc.fileSize)}</span>
                            <span className="mt-1 block text-[10px] text-muted-foreground">{doc.createdAt ? new Date(doc.createdAt).toLocaleString() : "—"}</span>
                          </button>
                          <div className="flex shrink-0 items-center gap-1">
                            <a href={`/api/documents/${doc.id}/view`} target="_blank" rel="noopener noreferrer" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50" aria-label={t("documents.openInNewTab")}><ExternalLink size={14} aria-hidden="true" /></a>
                            {canDelete ? <button type="button" className="rounded-md p-1.5 text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50" onClick={() => deleteDocument(doc.id)} disabled={deleteMutation.isPending} aria-label={t("documents.delete")}><Trash2 size={14} aria-hidden="true" /></button> : null}
                            <button type="button" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50" aria-label={t("requestScans.actions.more")} onClick={() => setFileMenuDocumentId((current) => current === doc.id ? null : doc.id)}><MoreVertical size={14} aria-hidden="true" /></button>
                          </div>
                        </div>
                        {fileMenuDocumentId === doc.id ? <div className="absolute end-2 top-10 z-20 w-40 rounded-lg border border-border bg-background p-1 shadow-lg"><button type="button" className="w-full rounded-md px-2 py-1.5 text-start text-xs hover:bg-muted" onClick={() => { setSelectedDocumentId(doc.id); setFileMenuDocumentId(null); }}>{t("documents.view")}</button><a href={`/api/documents/${doc.id}/view`} target="_blank" rel="noopener noreferrer" className="block rounded-md px-2 py-1.5 text-start text-xs hover:bg-muted" onClick={() => setFileMenuDocumentId(null)}>{t("documents.openInNewTab")}</a>{isPdf ? <><button type="button" disabled={printingDocumentId != null} className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-start text-xs hover:bg-muted disabled:opacity-50" onClick={() => void printPdfDocument(doc, "A4_DOCUMENT")}>{printingDocumentId === doc.id ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />}Print A4</button><button type="button" disabled={printingDocumentId != null} className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-start text-xs hover:bg-muted disabled:opacity-50" onClick={() => void printPdfDocument(doc, "A5_DOCUMENT")}>{printingDocumentId === doc.id ? <Loader2 size={13} className="animate-spin" /> : <Printer size={13} />}Print A5</button></> : null}{canDelete ? <button type="button" className="w-full rounded-md px-2 py-1.5 text-start text-xs text-red-700 hover:bg-red-50" onClick={() => { setFileMenuDocumentId(null); deleteDocument(doc.id); }}>{t("documents.delete")}</button> : null}</div> : null}
                        {isSelected ? <div className="mt-2 flex items-center gap-1.5 text-[10px] font-semibold text-accent"><CheckCircle2 size={13} aria-hidden="true" />{t("documents.view")}</div> : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
            {supplementaryPanel}
          </aside>}
        </div>
      </div>
    );
  }

  return (
    <div
      data-expanded={expanded ? "true" : "false"}
      className={previewMode === "inline" ? `flex h-full min-h-0 flex-col rounded-xl border border-stone-200 dark:border-stone-700 ${expanded ? "p-2" : "p-3"}` : "rounded-xl border border-stone-200 p-4 dark:border-stone-700"}
    >
      {!expanded ? (
        <div className="flex shrink-0 items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-stone-900 dark:text-white">{resolvedTitle}</h4>
        </div>
      ) : null}

      {!expanded ? <div className="mt-3 grid shrink-0 grid-cols-1 gap-2 md:grid-cols-3">
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
      </div> : null}
      {!expanded && enableLocalScan && canScanOrUpload && !naps2ScannerEnabled && (
        <p className="mt-2 shrink-0 text-xs text-stone-500">{t("documents.scanNotSupportedMessage")}</p>
      )}

      {!expanded && enableLocalScan && canScanOrUpload && (
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

      {!expanded && failedScanUploads.length > 0 && (
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
        <div className={`${expanded ? "mt-1" : "mt-3"} flex min-h-0 flex-1 flex-col gap-2`}>
          {expanded ? (
            <div className="flex shrink-0 items-center gap-2">
              <select
                className="input-premium h-8 min-w-0 flex-1 py-1 text-xs"
                aria-label={t("documents.documentSelector")}
                value={selectedDocumentId ?? ""}
                onChange={(event) => setSelectedDocumentId(Number(event.target.value))}
              >
                {documents.map((doc) => <option key={doc.id} value={doc.id}>{doc.originalFilename}</option>)}
              </select>
              {canDelete && selectedDocument ? (
                <button
                  type="button"
                  onClick={() => {
                    if (!window.confirm(t("documents.deleteConfirm"))) return;
                    deleteMutation.mutate(selectedDocument.id);
                  }}
                  className="shrink-0 rounded-md bg-red-100 px-2 py-1.5 text-xs text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:bg-red-900/30 dark:text-red-400"
                  disabled={deleteMutation.isPending}
                >
                  {t("documents.delete")}
                </button>
              ) : null}
            </div>
          ) : (
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
          )}
          {selectedDocument ? (
            <DocumentPreviewWorkspace
              document={selectedDocument}
              expanded={expanded}
              onExpandedChange={onExpandedChange}
              annotationToolbar={annotationToolbar}
              annotations={annotations}
              annotationTool={annotationTool}
              selectedAnnotationId={selectedAnnotationId}
              onSelectAnnotation={setSelectedAnnotationId}
              onCreateAnnotation={createAnnotation}
            />
          ) : null}
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
