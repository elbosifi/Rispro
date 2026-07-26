import { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { RequestDocument } from "@/lib/api-hooks";
import type { DocumentPreviewLabels } from "./document-preview-workspace";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

interface PdfDocumentPreviewProps {
  document: RequestDocument;
  labels: DocumentPreviewLabels;
  includeOpenAction: boolean;
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

function LazyPdfThumbnail({
  pageNumber,
  selectedPage,
  labels,
  onSelect,
}: {
  pageNumber: number;
  selectedPage: number;
  labels: DocumentPreviewLabels;
  onSelect: (pageNumber: number) => void;
}) {
  const isPriority = Math.abs(pageNumber - selectedPage) <= 1;
  const [isVisible, setIsVisible] = useState(isPriority);
  const [renderError, setRenderError] = useState(false);
  const thumbnailRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isPriority) {
      setIsVisible(true);
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return;
    }

    const element = thumbnailRef.current;
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
      ref={thumbnailRef}
      type="button"
      className={`flex h-[96px] w-[92px] shrink-0 flex-col items-center justify-between rounded-lg border-2 p-1.5 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
        selectedPage === pageNumber
          ? "border-accent bg-accent/10 font-semibold text-foreground"
          : "border-border bg-background hover:border-accent/50"
      }`}
      onClick={() => onSelect(pageNumber)}
      aria-label={`${labels.page} ${pageNumber}`}
      aria-current={selectedPage === pageNumber ? "page" : undefined}
    >
      <div className="flex h-[74px] w-full items-center justify-center overflow-hidden rounded border border-border bg-muted/20">
        {isVisible && !renderError ? (
          <Page
            pageNumber={pageNumber}
            width={76}
            renderTextLayer={false}
            renderAnnotationLayer={false}
            loading={<span className="text-[10px] text-muted-foreground">{labels.thumbnailLoading}</span>}
            onRenderError={() => setRenderError(true)}
          />
        ) : (
          <span className="text-[10px] text-muted-foreground">{renderError ? "!" : pageNumber}</span>
        )}
      </div>
      <span>{pageNumber}</span>
    </button>
  );
}

export default function PdfDocumentPreview({ document, labels, includeOpenAction }: PdfDocumentPreviewProps) {
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [selectedPage, setSelectedPage] = useState(1);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [mainWidth, setMainWidth] = useState(760);
  const mainPreviewRef = useRef<HTMLDivElement>(null);
  const file = useMemo(() => ({ url: `/api/documents/${document.id}/view`, withCredentials: true }), [document.id]);

  useEffect(() => {
    setPageCount(null);
    setSelectedPage(1);
    setPreviewError(null);
  }, [document.id]);

  useEffect(() => {
    const element = mainPreviewRef.current;
    if (!element) return;
    const updateWidth = () => setMainWidth(Math.max(240, Math.min(980, element.clientWidth - 32)));
    updateWidth();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const page = pageCount ? Math.min(selectedPage, pageCount) : 1;

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
      onLoadError={() => setPreviewError(labels.pdfFailed)}
      onSourceError={() => setPreviewError(labels.pdfFailed)}
      error={<PdfFailure document={document} labels={labels} includeOpenAction={includeOpenAction} message={labels.pdfFailed} />}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <div ref={mainPreviewRef} className="min-h-0 flex-1 overflow-auto rounded-xl border border-border bg-muted/20 p-4">
          {previewError ? (
            <PdfFailure document={document} labels={labels} includeOpenAction={includeOpenAction} message={previewError} />
          ) : (
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
          )}
        </div>

        <div className="h-[128px] shrink-0 rounded-xl border border-border bg-muted/10 p-2">
          <div className="flex h-full min-w-0 items-center gap-2">
            <div className="flex shrink-0 flex-col items-center gap-1">
              <div className="whitespace-nowrap text-xs font-semibold text-foreground">
                {pageCount ? labels.pageOf.replace("{page}", String(page)).replace("{count}", String(pageCount)) : labels.loading}
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  className="rounded-lg border border-border bg-background px-2 py-1 text-xs transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                  onClick={() => setSelectedPage((current) => Math.max(1, current - 1))}
                  disabled={!pageCount || page <= 1}
                  aria-label={labels.previous}
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-border bg-background px-2 py-1 text-xs transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                  onClick={() => setSelectedPage((current) => Math.min(pageCount ?? current, current + 1))}
                  disabled={!pageCount || page >= pageCount}
                  aria-label={labels.next}
                >
                  ›
                </button>
              </div>
            </div>
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-1" role="list" aria-label={labels.page}>
              {pageCount
                ? Array.from({ length: pageCount }, (_, index) => index + 1).map((pageNumber) => (
                    <LazyPdfThumbnail
                      key={pageNumber}
                      pageNumber={pageNumber}
                      selectedPage={page}
                      labels={labels}
                      onSelect={setSelectedPage}
                    />
                  ))
                : null}
            </div>
          </div>
        </div>
      </div>
    </Document>
  );
}
