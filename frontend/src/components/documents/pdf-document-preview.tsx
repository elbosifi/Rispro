import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { RequestDocument } from "@/lib/api-hooks";
import type { DocumentPreviewLabels } from "./document-preview-workspace";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

interface PdfDocumentPreviewProps {
  document: RequestDocument;
  labels: DocumentPreviewLabels;
  includeOpenAction: boolean;
  isRtl: boolean;
  expanded: boolean;
}

type PdfViewMode = "overview" | "single";
type PdfSizingMode = "fit-page" | "fit-width";
type PdfPageCardVariant = "overview" | "thumbnail";
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

function LazyPdfPageCard({
  pageNumber,
  selectedPage,
  variant,
  pdfDocument,
  overviewCardSize,
  labels,
  onSelect,
}: {
  pageNumber: number;
  selectedPage: number;
  variant: PdfPageCardVariant;
  pdfDocument: PDFDocumentProxy | null;
  overviewCardSize: PdfPageSize;
  labels: DocumentPreviewLabels;
  onSelect: (pageNumber: number) => void;
}) {
  const isPriority = Math.abs(pageNumber - selectedPage) <= 1;
  const isOverview = variant === "overview";
  const [isVisible, setIsVisible] = useState(isPriority);
  const [renderError, setRenderError] = useState(false);
  const [pageSize, setPageSize] = useState<PdfPageSize | null>(null);
  const pageCardRef = useRef<HTMLButtonElement>(null);
  const cardWidth = isOverview ? overviewCardSize.width : 92;
  const cardHeight = isOverview ? overviewCardSize.height : 96;
  const pageViewportWidth = Math.max(24, cardWidth - (isOverview ? 20 : 16));
  const pageViewportHeight = Math.max(24, cardHeight - (isOverview ? 42 : 22));
  const renderScale = pageSize
    ? Math.min(pageViewportWidth / pageSize.width, pageViewportHeight / pageSize.height)
    : null;

  useEffect(() => {
    if (isPriority) {
      setIsVisible(true);
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return;
    }

    const element = pageCardRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "120px 260px" }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [isPriority]);

  useEffect(() => {
    if (!isVisible || !pdfDocument) return;
    let cancelled = false;
    setPageSize(null);
    setRenderError(false);
    void pdfDocument
      .getPage(pageNumber)
      .then((pdfPage) => {
        if (cancelled) return;
        const viewport = pdfPage.getViewport({ scale: 1 });
        setPageSize({ width: viewport.width, height: viewport.height });
      })
      .catch(() => {
        if (!cancelled) setRenderError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isVisible, pageNumber, pdfDocument]);

  return (
    <button
      ref={pageCardRef}
      type="button"
      data-pdf-page={pageNumber}
      data-page-viewport-width={pageViewportWidth}
      data-page-viewport-height={pageViewportHeight}
      style={{ width: cardWidth, height: cardHeight }}
      className={`flex shrink-0 snap-start flex-col items-center justify-between rounded-lg border-2 bg-background text-xs transition hover:border-accent/60 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
        isOverview ? "p-2" : "p-1.5"
      } ${
        selectedPage === pageNumber
          ? "border-accent bg-accent/10 font-semibold text-foreground ring-1 ring-accent/30"
          : "border-border text-muted-foreground"
      }`}
      onClick={() => onSelect(pageNumber)}
      aria-label={
        isOverview
          ? labels.openPage.replace("{page}", String(pageNumber))
          : `${labels.page} ${pageNumber}`
      }
      aria-current={selectedPage === pageNumber ? "page" : undefined}
    >
      <div
        className="flex w-full items-center justify-center overflow-hidden rounded border border-border bg-muted/20"
        style={{ height: pageViewportHeight }}
      >
        {isVisible && !renderError && renderScale ? (
          <Page
            pageNumber={pageNumber}
            scale={renderScale}
            renderTextLayer={false}
            renderAnnotationLayer={false}
            loading={<span className="text-[10px] text-muted-foreground">{labels.thumbnailLoading}</span>}
            onRenderError={() => setRenderError(true)}
          />
        ) : (
          <span className="text-[10px] text-muted-foreground">{renderError ? "!" : pageNumber}</span>
        )}
      </div>
      <span className={isOverview ? "text-sm" : undefined}>{pageNumber}</span>
    </button>
  );
}

export default function PdfDocumentPreview({ document, labels, includeOpenAction, isRtl, expanded }: PdfDocumentPreviewProps) {
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [selectedPage, setSelectedPage] = useState(1);
  const [viewMode, setViewMode] = useState<PdfViewMode>("overview");
  const [sizingMode, setSizingMode] = useState<PdfSizingMode>(expanded ? "fit-page" : "fit-width");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [mainSize, setMainSize] = useState({ width: 760, height: 640 });
  const [overviewCardSize, setOverviewCardSize] = useState<PdfPageSize>({ width: 184, height: 244 });
  const mainPreviewRef = useRef<HTMLDivElement>(null);
  const overviewRef = useRef<HTMLDivElement>(null);
  const file = useMemo(() => ({ url: `/api/documents/${document.id}/view`, withCredentials: true }), [document.id]);
  const page = pageCount ? Math.min(selectedPage, pageCount) : 1;

  useEffect(() => {
    setPageCount(null);
    setPdfDocument(null);
    setSelectedPage(1);
    setViewMode("overview");
    setSizingMode(expanded ? "fit-page" : "fit-width");
    setPreviewError(null);
  }, [document.id]);

  useEffect(() => {
    if (viewMode !== "single") return;
    const element = mainPreviewRef.current;
    if (!element) return;
    const updateSize = () => setMainSize({ width: Math.max(240, element.clientWidth - 32), height: Math.max(240, element.clientHeight - 32) });
    updateSize();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [viewMode, expanded]);

  useEffect(() => {
    if (!expanded) return;
    setSizingMode("fit-page");
    setViewMode("single");
  }, [expanded]);

  const [selectedPageSize, setSelectedPageSize] = useState<PdfPageSize | null>(null);
  useEffect(() => {
    if (viewMode !== "single" || !pdfDocument) return;
    let cancelled = false;
    void pdfDocument.getPage(page).then((pdfPage) => {
      if (!cancelled) setSelectedPageSize(pdfPage.getViewport({ scale: 1 }));
    }).catch(() => {
      if (!cancelled) setSelectedPageSize(null);
    });
    return () => { cancelled = true; };
  }, [page, pdfDocument, viewMode]);

  const pageScale = selectedPageSize
    ? sizingMode === "fit-page"
      ? Math.min(mainSize.width / selectedPageSize.width, mainSize.height / selectedPageSize.height)
      : mainSize.width / selectedPageSize.width
    : null;

  useEffect(() => {
    if (viewMode !== "overview") return;
    const element = overviewRef.current;
    if (!element) return;
    const updateCardSize = () => {
      const availableHeight = element.clientHeight - 24;
      if (availableHeight <= 0) return;
      const height = Math.min(expanded ? 320 : 252, availableHeight);
      const width = Math.min(expanded ? 230 : 190, Math.max(112, Math.round(height * 0.75)));
      setOverviewCardSize({ width, height });
    };
    updateCardSize();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateCardSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, pageCount, viewMode]);

  useEffect(() => {
    if (viewMode !== "overview") return;
    const scrollSelectedCard = () => {
      const selectedCard = overviewRef.current?.querySelector<HTMLElement>(`[data-pdf-page="${selectedPage}"]`);
      selectedCard?.scrollIntoView?.({ behavior: "smooth", block: "nearest", inline: "center" });
    };
    if (typeof requestAnimationFrame === "undefined") {
      scrollSelectedCard();
      return;
    }
    const frame = requestAnimationFrame(scrollSelectedCard);
    return () => cancelAnimationFrame(frame);
  }, [selectedPage, viewMode]);

  const pages = pageCount ? Array.from({ length: pageCount }, (_, index) => index + 1) : [];
  const handlePreviewError = (error: unknown) => {
    if (import.meta.env.DEV) {
      console.warn("[RISpro] React-PDF preview failed:", safePdfDiagnostic(error));
    }
    setPreviewError(labels.pdfFailed);
  };
  const scrollOverview = (logicalDirection: -1 | 1) => {
    overviewRef.current?.scrollBy({
      left: logicalDirection * (isRtl ? -392 : 392),
      behavior: "smooth",
    });
  };

  return (
    <Document
      file={file}
      loading={<div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-border bg-muted/20 p-6 text-sm text-muted-foreground" role="status">{labels.loading}</div>}
      onLoadSuccess={(loadedPdf) => {
        const hadPageCount = pageCount !== null;
        setPdfDocument(loadedPdf);
        setPageCount(loadedPdf.numPages);
        if (!hadPageCount || pageCount !== loadedPdf.numPages) setSelectedPage(1);
        setPreviewError(null);
      }}
      onLoadError={handlePreviewError}
      onSourceError={handlePreviewError}
      error={<PdfFailure document={document} labels={labels} includeOpenAction={includeOpenAction} message={labels.pdfFailed} />}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {previewError ? (
          <PdfFailure document={document} labels={labels} includeOpenAction={includeOpenAction} message={previewError} />
        ) : viewMode === "overview" ? (
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-muted/10" aria-label={labels.pageOverview}>
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-2">
              <span className="text-xs font-semibold text-foreground">
                {pageCount ? labels.pagesCount.replace("{count}", String(pageCount)) : labels.loading}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="rounded-lg border border-border bg-background p-1.5 text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                  onClick={() => scrollOverview(-1)}
                  aria-label={isRtl ? labels.scrollPagesRight : labels.scrollPagesLeft}
                >
                  {isRtl ? <ChevronRight size={16} aria-hidden="true" /> : <ChevronLeft size={16} aria-hidden="true" />}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-border bg-background p-1.5 text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                  onClick={() => scrollOverview(1)}
                  aria-label={isRtl ? labels.scrollPagesLeft : labels.scrollPagesRight}
                >
                  {isRtl ? <ChevronLeft size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                </button>
              </div>
            </div>
            <div
              ref={overviewRef}
              className="flex min-h-0 flex-1 snap-x snap-mandatory items-center gap-3 overflow-x-auto overflow-y-hidden scroll-smooth overscroll-x-contain p-3 touch-pan-x"
              aria-label={labels.pageOverview}
              onWheel={(event) => {
                if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
                event.preventDefault();
                event.currentTarget.scrollBy({ left: event.deltaY * (isRtl ? -1 : 1) });
              }}
            >
              {pages.map((pageNumber) => (
                <LazyPdfPageCard
                  key={pageNumber}
                  pageNumber={pageNumber}
                  selectedPage={page}
                  variant="overview"
                  pdfDocument={pdfDocument}
                  overviewCardSize={overviewCardSize}
                  labels={labels}
                  onSelect={(nextPage) => {
                    setSelectedPage(nextPage);
                    setViewMode("single");
                  }}
                />
              ))}
            </div>
          </section>
        ) : (
          <>
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-muted/10 px-3 py-2">
              <button
                type="button"
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                onClick={() => setViewMode("overview")}
                aria-label={labels.backToAllPages}
              >
                {labels.backToAllPages}
              </button>
              <div className="flex items-center gap-2">
                <span className="whitespace-nowrap text-xs font-semibold text-foreground">
                  {pageCount ? labels.pageOf.replace("{page}", String(page)).replace("{count}", String(pageCount)) : labels.loading}
                </span>
                <button
                  type="button"
                  className="rounded-lg border border-border bg-background p-1.5 text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                  onClick={() => setSelectedPage((current) => Math.max(1, current - 1))}
                  disabled={!pageCount || page <= 1}
                  aria-label={labels.previous}
                >
                  {isRtl ? <ChevronRight size={16} aria-hidden="true" /> : <ChevronLeft size={16} aria-hidden="true" />}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-border bg-background p-1.5 text-foreground transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                  onClick={() => setSelectedPage((current) => Math.min(pageCount ?? current, current + 1))}
                  disabled={!pageCount || page >= pageCount}
                  aria-label={labels.next}
                >
                  {isRtl ? <ChevronLeft size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                </button>
                <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-0.5" role="group" aria-label="PDF sizing">
                  <button type="button" className={`rounded-md px-2 py-1 text-[11px] ${sizingMode === "fit-page" ? "bg-accent/10 font-semibold text-foreground" : "text-muted-foreground"}`} onClick={() => setSizingMode("fit-page")} aria-pressed={sizingMode === "fit-page"}>{labels.fitPage}</button>
                  <button type="button" className={`rounded-md px-2 py-1 text-[11px] ${sizingMode === "fit-width" ? "bg-accent/10 font-semibold text-foreground" : "text-muted-foreground"}`} onClick={() => setSizingMode("fit-width")} aria-pressed={sizingMode === "fit-width"}>{labels.fitWidth}</button>
                </div>
              </div>
            </div>
            <div ref={mainPreviewRef} className="min-h-0 min-w-0 flex-1 overflow-auto rounded-xl border border-border bg-muted/20 p-4">
              <div className={`flex min-h-full min-w-full justify-center ${sizingMode === "fit-page" ? "items-center" : "items-start"}`}>
                <Page
                  pageNumber={page}
                  width={sizingMode === "fit-width" ? mainSize.width : undefined}
                  scale={sizingMode === "fit-page" ? pageScale ?? 1 : undefined}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  loading={<span className="text-sm text-muted-foreground">{labels.loading}</span>}
                  onRenderError={() => setPreviewError(labels.pageFailed)}
                />
              </div>
            </div>
            <div className="h-[112px] shrink-0 rounded-xl border border-border bg-muted/10 p-2">
              <div className="flex h-full min-w-0 snap-x items-center gap-2 overflow-x-auto overflow-y-hidden scroll-smooth py-1" aria-label={labels.allPages}>
                {pages.map((pageNumber) => (
                  <LazyPdfPageCard
                    key={pageNumber}
                    pageNumber={pageNumber}
                    selectedPage={page}
                    variant="thumbnail"
                    pdfDocument={pdfDocument}
                    overviewCardSize={overviewCardSize}
                    labels={labels}
                    onSelect={setSelectedPage}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </Document>
  );
}
