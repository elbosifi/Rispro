import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RotateCcw, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { RequestDocument } from "@/lib/api-hooks";
import type { DocumentPreviewLabels } from "./document-preview-workspace";
import type { DocumentUtilityToolbarPlacement, PdfInitialSizingMode } from "./document-preview-workspace";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

interface PdfDocumentPreviewProps {
  document: RequestDocument;
  labels: DocumentPreviewLabels;
  includeOpenAction: boolean;
  isRtl: boolean;
  expanded: boolean;
  preferSinglePage: boolean;
  annotationOverlay?: (pageNumber: number, rotation: number) => ReactNode;
  annotationToolbar?: ReactNode;
  onExpandedChange?: (expanded: boolean) => void;
  showOpenAction: boolean;
  utilityToolbarPlacement: DocumentUtilityToolbarPlacement;
  initialPdfSizingMode: PdfInitialSizingMode;
}

type PdfSizingMode = "fit-page" | "fit-width";
type PdfPageSize = { width: number; height: number };

function safePdfDiagnostic(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error ?? "Unknown PDF preview error");
  return rawMessage
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[A-Za-z]:\\\S+/g, "[path]")
    .replace(/\/(?:[^/\s]+\/)+[^/\s)]+/g, "[path]")
    .slice(0, 240);
}

function PdfFailure({ message, document, labels, includeOpenAction }: Pick<PdfDocumentPreviewProps, "document" | "labels" | "includeOpenAction"> & { message: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200" role="alert">
      <p>{message}</p>
      {includeOpenAction ? (
        <a
          href={`/api/documents/${document.id}/view`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          {labels.openInNewTab}
        </a>
      ) : null}
    </div>
  );
}

export default function PdfDocumentPreview({ document, labels, includeOpenAction, expanded, utilityToolbarPlacement, initialPdfSizingMode, annotationOverlay, annotationToolbar, onExpandedChange, showOpenAction }: PdfDocumentPreviewProps) {
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageSizes, setPageSizes] = useState<Record<number, PdfPageSize>>({});
  const [sizingMode, setSizingMode] = useState<PdfSizingMode>(initialPdfSizingMode);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [mainSize, setMainSize] = useState({ width: 760, height: 640 });
  const mainPreviewRef = useRef<HTMLDivElement>(null);
  const file = useMemo(() => ({ url: `/api/documents/${document.id}/view`, withCredentials: true }), [document.id]);

  useEffect(() => {
    const element = mainPreviewRef.current;
    if (!element) return;
    const updateSize = () => setMainSize({ width: Math.max(240, element.clientWidth - 16), height: Math.max(240, element.clientHeight - 16) });
    updateSize();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    const frame = typeof requestAnimationFrame === "undefined" ? null : requestAnimationFrame(updateSize);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [expanded]);

  useEffect(() => {
    if (!pdfDocument || !pageCount) return;
    let cancelled = false;
    void Promise.all(
      Array.from({ length: pageCount }, async (_, index) => {
        const pageNumber = index + 1;
        try {
          const pdfPage = await pdfDocument.getPage(pageNumber);
          const viewport = pdfPage.getViewport({ scale: 1 });
          return [pageNumber, { width: viewport.width, height: viewport.height }] as const;
        } catch {
          return null;
        }
      })
    ).then((entries) => {
      if (cancelled) return;
      setPageSizes(Object.fromEntries(entries.filter((entry): entry is readonly [number, PdfPageSize] => entry !== null)));
    });
    return () => {
      cancelled = true;
    };
  }, [pageCount, pdfDocument]);

  const pages = pageCount ? Array.from({ length: pageCount }, (_, index) => index + 1) : [];
  const pageScale = (pageNumber: number) => {
    const pageSize = pageSizes[pageNumber];
    if (!pageSize) return zoom;
    return Math.min(mainSize.width / pageSize.width, mainSize.height / pageSize.height) * zoom;
  };
  const handlePreviewError = (error: unknown) => {
    if (import.meta.env.DEV) {
      console.warn("[RISpro] React-PDF preview failed:", safePdfDiagnostic(error));
    }
    setPreviewError(labels.pdfFailed);
  };
  const openDocumentAction = showOpenAction ? <a href={`/api/documents/${document.id}/view`} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 shrink-0 items-center rounded-md border border-border bg-background px-2 text-[11px] font-semibold text-foreground hover:bg-muted">{labels.openInNewTab}</a> : null;
  const expandAction = onExpandedChange ? <button type="button" className="inline-flex h-8 shrink-0 items-center rounded-md border border-border bg-background px-2 text-[11px] font-semibold text-foreground hover:bg-muted" onClick={() => onExpandedChange(!expanded)} aria-pressed={expanded}>{expanded ? labels.exitExpandedReview : labels.expandReview}</button> : null;
  const pageTools = <>
    <div className="flex shrink-0 items-center gap-0.5">
      <div className="flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5" role="group" aria-label="PDF sizing">
        <button type="button" className={`rounded px-1.5 py-1 text-[10px] ${sizingMode === "fit-page" ? "bg-accent/10 font-semibold text-foreground" : "text-muted-foreground"}`} onClick={() => setSizingMode("fit-page")} aria-pressed={sizingMode === "fit-page"}>{labels.fitPage}</button>
        <button type="button" className={`rounded px-1.5 py-1 text-[10px] ${sizingMode === "fit-width" ? "bg-accent/10 font-semibold text-foreground" : "text-muted-foreground"}`} onClick={() => setSizingMode("fit-width")} aria-pressed={sizingMode === "fit-width"}>{labels.fitWidth}</button>
      </div>
      <div className="flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5" role="group" aria-label="Zoom">
        <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-50" onClick={() => setZoom((current) => Math.max(0.5, Number((current - 0.1).toFixed(1))))} disabled={zoom <= 0.5} aria-label="Zoom out" title="Zoom out"><ZoomOut size={14} aria-hidden="true" /></button>
        <span className="min-w-9 text-center text-[10px] font-semibold text-muted-foreground">{Math.round(zoom * 100)}%</span>
        <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-50" onClick={() => setZoom((current) => Math.min(2, Number((current + 0.1).toFixed(1))))} disabled={zoom >= 2} aria-label="Zoom in" title="Zoom in"><ZoomIn size={14} aria-hidden="true" /></button>
      </div>
      <div className="flex items-center gap-0.5 rounded-md border border-border bg-background p-0.5" role="group" aria-label="Rotate">
        <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted" onClick={() => setRotation((current) => (current + 270) % 360)} aria-label="Rotate counter-clockwise" title="Rotate counter-clockwise"><RotateCcw size={14} aria-hidden="true" /></button>
        <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted" onClick={() => setRotation((current) => (current + 90) % 360)} aria-label="Rotate clockwise" title="Rotate clockwise"><RotateCw size={14} aria-hidden="true" /></button>
      </div>
    </div>
    {expandAction}
    {openDocumentAction}
  </>;
  const documentUtilityBar = previewError ? null : <div className="flex min-h-9 min-w-0 shrink-0 items-center justify-end gap-1 overflow-x-auto rounded-lg border border-border bg-muted/10 px-1 py-0.5" role="toolbar" aria-label="Document utilities">{pageTools}</div>;

  return (
    <Document
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      file={file}
      loading={<div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-border bg-muted/20 p-6 text-sm text-muted-foreground" role="status">{labels.loading}</div>}
      onLoadSuccess={(loadedPdf) => {
        setPdfDocument(loadedPdf);
        setPageCount(loadedPdf.numPages);
        setPageSizes({});
        setPreviewError(null);
      }}
      onLoadError={handlePreviewError}
      onSourceError={handlePreviewError}
      error={<PdfFailure document={document} labels={labels} includeOpenAction={includeOpenAction} message={labels.pdfFailed} />}
    >
      <div className={`grid h-full min-h-0 min-w-0 flex-1 gap-1 ${utilityToolbarPlacement === "top" ? "grid-rows-[auto_minmax(0,1fr)]" : "grid-rows-[minmax(0,1fr)_auto]"}`}>
        {utilityToolbarPlacement === "top" ? documentUtilityBar : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-hidden">
          {previewError ? (
            <PdfFailure document={document} labels={labels} includeOpenAction={includeOpenAction} message={previewError} />
          ) : (
            <>
              {annotationToolbar ? <div className="flex min-h-9 min-w-0 shrink-0 flex-nowrap items-center gap-1 overflow-x-auto rounded-lg border border-border bg-muted/10 px-1 py-0.5" role="toolbar" aria-label="PDF document controls">{annotationToolbar}</div> : null}
              <div ref={mainPreviewRef} className="min-h-0 min-w-0 flex-1 overflow-auto rounded-xl border border-border bg-muted/20 p-2">
                <div className="flex min-w-full flex-col items-center gap-4">
                  {pages.map((pageNumber) => (
                    <div key={pageNumber} className="relative shrink-0">
                      <Page
                        pageNumber={pageNumber}
                        width={sizingMode === "fit-width" ? mainSize.width * zoom : undefined}
                        scale={sizingMode === "fit-page" ? pageScale(pageNumber) : undefined}
                        renderTextLayer={false}
                        renderAnnotationLayer={false}
                        loading={<span className="text-sm text-muted-foreground">{labels.loading}</span>}
                        onRenderError={() => setPreviewError(labels.pageFailed)}
                        rotate={rotation}
                      />
                      {annotationOverlay?.(pageNumber, rotation)}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
        {utilityToolbarPlacement === "bottom" ? documentUtilityBar : null}
      </div>
    </Document>
  );
}
