import { Component, lazy, Suspense, useState, type ReactNode } from "react";
import { useLanguage } from "@/providers/language-provider";
import type { TranslationKey } from "@/lib/i18n";
import type { RequestDocument } from "@/lib/api-hooks";

export interface DocumentPreviewLabels {
  loading: string;
  imageLoading: string;
  imageFailed: string;
  pdfFailed: string;
  pageFailed: string;
  unsupported: string;
  openInNewTab: string;
  previous: string;
  next: string;
  page: string;
  pageOf: string;
  thumbnailLoading: string;
}

const LazyPdfDocumentPreview = lazy(() => import("./pdf-document-preview"));

interface PreviewErrorBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
}

interface PreviewErrorBoundaryState {
  hasError: boolean;
}

class PreviewErrorBoundary extends Component<PreviewErrorBoundaryProps, PreviewErrorBoundaryState> {
  state: PreviewErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): PreviewErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

function viewUrl(document: RequestDocument): string {
  return `/api/documents/${document.id}/view`;
}

function previewKind(document: RequestDocument): "pdf" | "image" | "unsupported" {
  const mimeType = document.mimeType.toLowerCase();
  const filename = document.originalFilename.toLowerCase();
  if (mimeType) {
    if (mimeType === "application/pdf") return "pdf";
    if (mimeType === "image/jpeg" || mimeType === "image/png") return "image";
    return "unsupported";
  }
  if (filename.endsWith(".pdf")) return "pdf";
  if (/\.(jpe?g|png)$/.test(filename)) return "image";
  return "unsupported";
}

function OpenDocumentAction({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
    >
      {label}
    </a>
  );
}

function PreviewFailure({ message, href, label, includeOpenAction = true }: { message: string; href: string; label: string; includeOpenAction?: boolean }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-200" role="alert">
      <p>{message}</p>
      {includeOpenAction ? <OpenDocumentAction href={href} label={label} /> : null}
    </div>
  );
}

function ImagePreview({ document, labels, includeOpenAction }: { document: RequestDocument; labels: DocumentPreviewLabels; includeOpenAction: boolean }) {
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const src = viewUrl(document);

  if (imageError) {
    return <PreviewFailure message={labels.imageFailed} href={src} label={labels.openInNewTab} includeOpenAction={includeOpenAction} />;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border bg-muted/20 p-3">
        <div className="flex min-h-full items-center justify-center">
          {!imageLoaded ? <span className="text-sm text-muted-foreground" role="status">{labels.imageLoading}</span> : null}
          <img
            src={src}
            alt={document.originalFilename}
            className={`max-h-full max-w-full object-contain ${imageLoaded ? "" : "hidden"}`}
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageError(true)}
          />
        </div>
      </div>
      <div className="h-[120px] shrink-0 rounded-xl border border-border bg-muted/10 p-2">
        <div className="flex h-full items-center gap-2 overflow-x-auto" role="list" aria-label={labels.page}>
          <button
            type="button"
            className="flex h-[92px] w-[90px] shrink-0 flex-col items-center justify-between rounded-lg border-2 border-accent bg-accent/10 p-1.5 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
            aria-label={`${labels.page} 1`}
            aria-current="page"
          >
            <div className="flex h-[72px] w-full items-center justify-center overflow-hidden rounded border border-border bg-background">
              <img src={src} alt="" className="max-h-full max-w-full object-contain" onLoad={() => setImageLoaded(true)} onError={() => setImageError(true)} />
            </div>
            <span className="text-[11px] font-semibold">1</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function labelsFor(t: (key: TranslationKey) => string): DocumentPreviewLabels {
  return {
    loading: t("documents.previewLoading"),
    imageLoading: t("documents.previewImageLoading"),
    imageFailed: t("documents.previewImageFailed"),
    pdfFailed: t("documents.previewPdfFailed"),
    pageFailed: t("documents.previewPageFailed"),
    unsupported: t("documents.previewUnsupported"),
    openInNewTab: t("documents.openInNewTab"),
    previous: t("documents.previousPage"),
    next: t("documents.nextPage"),
    page: t("documents.page"),
    pageOf: t("documents.pageOf"),
    thumbnailLoading: t("documents.thumbnailLoading"),
  };
}

export function DocumentPreviewWorkspace({ document, showOpenAction = true }: { document: RequestDocument; showOpenAction?: boolean }) {
  const { t } = useLanguage();
  const labels = labelsFor(t);
  const kind = previewKind(document);
  const src = viewUrl(document);

  if (kind === "unsupported") {
    return <PreviewFailure message={labels.unsupported} href={src} label={labels.openInNewTab} />;
  }

  if (kind === "image") {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        {showOpenAction ? <div className="flex shrink-0 justify-end"><OpenDocumentAction href={src} label={labels.openInNewTab} /></div> : null}
        <ImagePreview document={document} labels={labels} includeOpenAction={!showOpenAction} />
      </div>
    );
  }

  return (
    <PreviewErrorBoundary
      fallback={<PreviewFailure message={labels.pdfFailed} href={src} label={labels.openInNewTab} includeOpenAction={!showOpenAction} />}
    >
      <Suspense
        fallback={
          <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-border bg-muted/20 p-6 text-sm text-muted-foreground" role="status">
            {labels.loading}
          </div>
        }
      >
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          {showOpenAction ? <div className="flex shrink-0 justify-end"><OpenDocumentAction href={src} label={labels.openInNewTab} /></div> : null}
          <LazyPdfDocumentPreview document={document} labels={labels} includeOpenAction={!showOpenAction} />
        </div>
      </Suspense>
    </PreviewErrorBoundary>
  );
}
