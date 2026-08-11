import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, ScanLine, Trash2, Upload } from "lucide-react";
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/shared";
import { DocumentPreviewWorkspace } from "@/components/documents/document-preview-workspace";
import {
  deleteComparisonDocument,
  fetchIntegrationStatus,
  listComparisonDocuments,
  uploadComparisonDocument,
  type RequestDocument,
} from "@/lib/api-hooks";
import { scanAppointmentRequest } from "@/lib/naps2-webscan";
import { pushToast } from "@/lib/toast";
import { t } from "@/lib/i18n";
import { useLanguage } from "@/providers/language-provider";
import { resolveEffectiveNaps2Endpoint } from "@/services/scanning/workstation-naps2-settings";

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ComparisonDocumentsPanel({
  comparisonRequestId,
  canAttach,
  canDelete,
}: {
  comparisonRequestId: number;
  canAttach: boolean;
  canDelete: boolean;
}) {
  const { language } = useLanguage();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<RequestDocument | null>(null);
  const queryKey = useMemo(() => ["comparison-documents", comparisonRequestId], [comparisonRequestId]);
  const documentsQuery = useQuery({
    queryKey,
    queryFn: () => listComparisonDocuments(comparisonRequestId),
  });
  const integrationQuery = useQuery({
    queryKey: ["integration-status", "comparison-documents"],
    queryFn: fetchIntegrationStatus,
    enabled: canAttach,
    staleTime: 60_000,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey });
    void queryClient.invalidateQueries({ queryKey: ["comparison-requests"] });
    void queryClient.invalidateQueries({ queryKey: ["comparison-request", comparisonRequestId] });
  };

  const uploadMutation = useMutation({
    mutationFn: async ({ sourceFile, source }: { sourceFile: File; source: "manual_upload" | "naps2_webscan" }) =>
      uploadComparisonDocument({
        comparisonRequestId,
        originalFilename: sourceFile.name,
        mimeType: sourceFile.type || "application/octet-stream",
        fileContentBase64: await fileToBase64(sourceFile),
        source,
      }),
    onSuccess: () => {
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      refresh();
      pushToast({ type: "success", title: t(language, "comparisons.attachSuccess"), message: t(language, "comparisons.attachSuccessMessage") });
    },
    onError: (error) => pushToast({
      type: "error",
      title: t(language, "comparisons.attachFailed"),
      message: error instanceof Error ? error.message : t(language, "comparisons.attachFailedMessage"),
    }),
  });

  const scanMutation = useMutation({
    mutationFn: async () => {
      const scanner = integrationQuery.data?.scanner;
      const enabled = Boolean(scanner?.naps2WebScanEnabled || scanner?.scannerBridgeMode === "naps2_webscan");
      if (!enabled) throw new Error(t(language, "comparisons.scanDisabled"));
      const endpoint = resolveEffectiveNaps2Endpoint(scanner?.naps2WebScanEndpoint);
      const result = await scanAppointmentRequest({
        endpoint: endpoint.endpoint,
        dpi: Number(scanner?.scanDpi || 200),
        colorMode: scanner?.scanColorMode === "color" ? "color" : "grayscale",
        source: scanner?.scannerSource === "flatbed" ? "flatbed" : scanner?.scannerSource === "duplex" ? "duplex" : "feeder",
        fileName: `comparison-${comparisonRequestId}-papers.pdf`,
      });
      return uploadMutation.mutateAsync({ sourceFile: result.file, source: result.source });
    },
    onError: (error) => pushToast({
      type: "error",
      title: t(language, "comparisons.scanFailed"),
      message: error instanceof Error ? error.message : t(language, "comparisons.scanFailedMessage"),
    }),
  });

  const deleteMutation = useMutation({
    mutationFn: (documentId: number) => deleteComparisonDocument(comparisonRequestId, documentId),
    onSuccess: (_result, documentId) => {
      if (selectedDocument?.id === documentId) setSelectedDocument(null);
      refresh();
      pushToast({ type: "success", title: t(language, "comparisons.removeSuccess"), message: t(language, "comparisons.removeSuccessMessage") });
    },
    onError: (error) => pushToast({
      type: "error",
      title: t(language, "comparisons.removeFailed"),
      message: error instanceof Error ? error.message : t(language, "comparisons.removeFailedMessage"),
    }),
  });

  const documents = documentsQuery.data ?? [];
  const scanner = integrationQuery.data?.scanner;
  const naps2Enabled = Boolean(scanner?.naps2WebScanEnabled || scanner?.scannerBridgeMode === "naps2_webscan");
  const busy = uploadMutation.isPending || scanMutation.isPending;

  return (
    <section className="rounded-lg border border-border bg-muted/10 p-3" aria-label={t(language, "comparisons.papers")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold">{t(language, "comparisons.papers")}</h4>
          <p className="text-xs text-muted-foreground">
            {documentsQuery.isLoading ? t(language, "comparisons.loadingAttachments") : documents.length === 0 ? t(language, "comparisons.noneAttached") : t(language, "comparisons.attachedCount", { count: documents.length })}
          </p>
        </div>
        {canAttach ? (
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-semibold">
              <Upload size={14} />
              {file ? file.name : t(language, "comparisons.upload")}
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                className="sr-only"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                aria-label={t(language, "comparisons.choosePaper")}
              />
            </label>
            {file ? (
              <Button size="sm" type="button" disabled={busy} onClick={() => uploadMutation.mutate({ sourceFile: file, source: "manual_upload" })}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                {t(language, "comparisons.attach")}
              </Button>
            ) : null}
            {naps2Enabled ? (
              <Button size="sm" variant="secondary" type="button" disabled={busy} onClick={() => scanMutation.mutate()}>
                {scanMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <ScanLine size={14} />}
                {t(language, "comparisons.scan")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {documentsQuery.error ? <p className="mt-2 text-xs text-red-600">{t(language, "comparisons.papersLoadError")}</p> : null}
      {documents.length ? (
        <ul className="mt-3 grid gap-2">
          {documents.map((document) => (
            <li key={document.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs">
              <button type="button" className="min-w-0 flex-1 text-start" onClick={() => setSelectedDocument(document)}>
                <span className="block truncate font-semibold">{document.originalFilename}</span>
                <span className="text-muted-foreground">{formatFileSize(document.fileSize)}</span>
              </button>
              {canDelete ? (
                <button
                  type="button"
                  className="rounded p-1.5 text-red-600 hover:bg-red-50"
                  aria-label={t(language, "comparisons.removePaper", { name: document.originalFilename })}
                  disabled={deleteMutation.isPending}
                  onClick={() => {
                    if (window.confirm(t(language, "comparisons.removeConfirm"))) deleteMutation.mutate(document.id);
                  }}
                >
                  <Trash2 size={14} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <Dialog open={Boolean(selectedDocument)} onClose={() => setSelectedDocument(null)}>
        <DialogContent maxWidth="min(96vw, 1100px)" className="h-[90vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>{selectedDocument?.originalFilename || t(language, "comparisons.paper")}</DialogTitle>
          </DialogHeader>
          {selectedDocument ? <div className="min-h-0 flex-1 overflow-hidden"><DocumentPreviewWorkspace document={selectedDocument} /></div> : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
