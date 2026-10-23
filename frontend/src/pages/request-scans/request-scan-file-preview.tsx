import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { t, type Language } from "@/lib/i18n";

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

type PreviewProps = { file: Blob; filename: string; language: Language; title: string };

function ImagePreview({ file, filename }: PreviewProps) {
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    if (image.current) image.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return <div className="flex h-full w-full items-center justify-center"><img ref={image} className="h-full w-full object-contain" alt={filename} /></div>;
}

function PdfPreview({ file, language, title }: PreviewProps) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(300);
  const [pages, setPages] = useState(0);
  const [renderFailed, setRenderFailed] = useState(false);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const resize = () => setWidth(Math.max(1, element.clientWidth - 16));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const loading = <p role="status" className="p-4 text-sm text-muted-foreground">{t(language, "requestScans.preview.loading")}</p>;
  const failure = <p role="alert" className="p-4 text-sm text-red-700">{t(language, "requestScans.preview.failed")}</p>;

  return (
    <div ref={container} role="region" aria-label={title} className="h-full w-full overflow-auto">
      {renderFailed ? failure : <Document
        file={file}
        className="flex min-h-full flex-col items-center gap-3 p-2"
        loading={loading}
        error={failure}
        onLoadSuccess={({ numPages }) => setPages(numPages)}
      >
        {Array.from({ length: pages }, (_, index) => (
          <Page
            key={index + 1}
            pageNumber={index + 1}
            width={width}
            renderTextLayer={false}
            renderAnnotationLayer={false}
            loading={loading}
            error={failure}
            onRenderError={() => setRenderFailed(true)}
          />
        ))}
      </Document>}
    </div>
  );
}

export default function RequestScanFilePreview(props: PreviewProps) {
  // Read the authenticated Blob directly: PDF rendering needs no native browser plugin
  // or additional fetch of a blob: URL under the application's connect-src policy.
  return props.filename.toLowerCase().endsWith(".pdf") ? <PdfPreview {...props} /> : <ImagePreview {...props} />;
}
