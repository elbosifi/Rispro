import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import type { RequestDocument } from "@/lib/api-hooks";
import type { DocumentPreviewLabels } from "./document-preview-workspace";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

interface PdfDocumentPreviewProps {
  document: RequestDocument;
  labels: DocumentPreviewLabels;
  includeOpenAction: boolean;
  isRtl: boolean;
}

type PdfViewMode = "overview" | "single";
type PdfPageCardVariant = "overview" | "thumbnail";

function safePdfDiagnostic(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : String(error ?? "Unknown PDF preview error");
  return rawMessage
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[A-Za-z]:\\\S+/g, "[path]")
    .replace(/\/(?:[^/\s]+\/)+[^/\s)]+/g, "[path]")
    .slice(0, 240);
}

function PdfFailure({ message, document, labels, includeOpenAction }: PdfDocumentPreviewProps & { message: string }) {
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
  labels,
  onSelect,
}: {
  pageNumber: number;
  selectedPage: number;
  variant: PdfPageCardVariant;
  labels: DocumentPreviewLabels;
  onSelect: (pageNumber: number) => void;
}) {
  const isPriority = Math.abs(pageNumber - selectedPage) <= 1;
  const isOverview = variant === "overview";
  const [isVisible, setIsVisible] = useState(isPriority);
  const [renderError, setRenderError] = useState(false);
  const pageCardRef = useRef<HTMLButtonElement>(null);

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

  return (
    <button
      ref={pageCardRef}
      type="button"
      data-pdf-page={pageNumber}
      className={`flex shrink-0 snap-start flex-col items-center justify-between rounded-lg border-2 bg-background text-xs transition hover:border-accent/60 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
        isOverview ? "h-[244px] w-[184px] p-2" : "h-[96px] w-[92px] p-1.5"
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
        className={`flex w-full items-center justify-center overflow-hidden rounded border border-border bg-muted/20 ${
          isOverview ? "h-[210px]" : "h-[74px]"
        }`}
      >
        {isVisible && !renderError ? (
          <Page
            pageNumber={pageNumber}
            width={isOverview ? 166 : 76}
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

export default function PdfDocumentPreview({ document, labels, includeOpenAction, isRtl }: PdfDocumentPreviewProps) {
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [selectedPage, setSelectedPage] = useState(1);
  const [viewMode, setViewMode] = useState<PdfViewMode>("overview");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [mainWidth, setMainWidth] = useState(760);
  const mainPreviewRef = useRef<HTMLDivElement>(null);
  const overviewRef = useRef<HTMLDivElement>(null);
  const file = useMemo(() => ({ url: `/api/documents/${document.id}/view`, withCredentials: true }), [document.id]);

  useEffect(() => {
    setPageCount(null);
    setSelectedPage(1);
    setViewMode("overview");
    setPreviewError(null);
  }, [document.id]);

  useEffect(() => {
    if (viewMode !== "single") return;
    const element = mainPreviewRef.current;
    if (!element) return;
    const updateWidth = () => setMainWidth(Math.max(240, Math.min(980, element.clientWidth - 32)));
    updateWidth();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, [viewMode]);

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

  const page = pageCount ? Math.min(selectedPage, pageCount) : 1;
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
      onLoadSuccess={({ numPages }) => {
        const hadPageCount = pageCount !== null;
        setPageCount(numPages);
        if (!hadPageCount || pageCount !== numPages) setSelectedPage(1);
        setPreviewError(null);
      }}
      onLoadError={handlePreviewError}
      onSourceError={handlePreviewError}
      error={<PdfFailure document={document} labels={labels} includeOpenAction={includeOpenAction} message={labels.pdfFailed} isRtl={isRtl} />}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {previewError ? (
          <PdfFailure document={document} labels={labels} includeOpenAction={includeOpenAction} message={previewError} isRtl={isRtl} />
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
              </div>
            </div>
            <div ref={mainPreviewRef} className="min-h-0 flex-1 overflow-auto rounded-xl border border-border bg-muted/20 p-4">
              <div className="flex min-h-full min-w-full items-start justify-center">
                <Page
                  pageNumber={page}
                  width={mainWidth}
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
