import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/shared";
import type { TeachingLearnerQuestion } from "../api/teaching-api";

type TeachingImage = TeachingLearnerQuestion["images"][number];

const supportedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const minimumZoom = 1;
const maximumZoom = 4;

function imageAlt(image: TeachingImage, index: number, total: number): string {
  return image.altText.trim() || `Teaching image ${index + 1} of ${total}`;
}

function TeachingImageViewerState({ images }: { images: TeachingImage[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [loadedImageIds, setLoadedImageIds] = useState<Set<number>>(() => new Set());
  const [failedImageIds, setFailedImageIds] = useState<Set<number>>(() => new Set());
  const dragStart = useRef<{ pointerId: number; x: number; y: number; panX: number; panY: number } | null>(null);
  const activeImage = images[activeIndex];
  const resetTransform = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setIsDragging(false);
    dragStart.current = null;
  }, []);

  const selectImage = useCallback((nextIndex: number) => {
    setActiveIndex(nextIndex);
    resetTransform();
  }, [resetTransform]);

  const changeZoom = (factor: number) => {
    const next = Math.max(minimumZoom, Math.min(maximumZoom, zoom * factor));
    setZoom(next);
    if (next === minimumZoom) setPan({ x: 0, y: 0 });
  };

  useEffect(() => {
    if (!viewerOpen || images.length < 2) return;
    const handleArrowKeys = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable=true]")) return;
      if (event.key === "ArrowLeft" && activeIndex > 0) {
        event.preventDefault();
        selectImage(activeIndex - 1);
      } else if (event.key === "ArrowRight" && activeIndex < images.length - 1) {
        event.preventDefault();
        selectImage(activeIndex + 1);
      }
    };
    document.addEventListener("keydown", handleArrowKeys);
    return () => document.removeEventListener("keydown", handleArrowKeys);
  }, [activeIndex, images.length, selectImage, viewerOpen]);

  if (!activeImage) return null;

  const activeAlt = imageAlt(activeImage, activeIndex, images.length);
  const isSupported = supportedMimeTypes.has(activeImage.mimeType.toLowerCase());
  const activeFailed = !isSupported || failedImageIds.has(activeImage.id);
  const activeLoading = isSupported && !activeFailed && !loadedImageIds.has(activeImage.id);

  const onImageLoad = (image: TeachingImage) => {
    setLoadedImageIds((current) => new Set(current).add(image.id));
  };

  const onImageError = (image: TeachingImage) => {
    setFailedImageIds((current) => new Set(current).add(image.id));
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    changeZoom(event.deltaY < 0 ? 1.15 : 1 / 1.15);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (zoom <= 1 || (event.button !== 0 && event.pointerType !== "touch")) return;
    event.preventDefault();
    dragStart.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    setIsDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start || start.pointerId !== event.pointerId) return;
    setPan({ x: start.panX + event.clientX - start.x, y: start.panY + event.clientY - start.y });
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragStart.current?.pointerId !== event.pointerId) return;
    dragStart.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const previousImage = () => { if (activeIndex > 0) selectImage(activeIndex - 1); };
  const nextImage = () => { if (activeIndex < images.length - 1) selectImage(activeIndex + 1); };

  return (
    <section aria-label="Question images" data-testid="teaching-question-images" className="space-y-3">
      <div className="relative overflow-hidden rounded-xl border border-border bg-muted/30">
        <div className="flex h-[62vh] max-h-[42rem] min-h-[15rem] items-center justify-center bg-black p-2 sm:min-h-[20rem] sm:p-4 lg:min-h-[26rem]">
          <button
            type="button"
            onClick={() => setViewerOpen(true)}
            aria-label={`Enlarge ${activeAlt}`}
            className="relative flex h-full min-h-[14rem] max-h-[58vh] w-full items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
          >
            {isSupported && !failedImageIds.has(activeImage.id) ? (
              <img
                src={activeImage.url}
                alt={activeAlt}
                onLoad={() => onImageLoad(activeImage)}
                onError={() => onImageError(activeImage)}
                className="h-full w-full object-contain"
              />
            ) : <span className="rounded-md bg-white/10 px-4 py-3 text-sm text-white">This Teaching image could not be displayed.</span>}
            {activeLoading ? <span role="status" className="absolute inset-x-3 bottom-3 rounded bg-black/70 px-3 py-2 text-center text-xs text-white">Loading image…</span> : null}
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-sm">
          <span aria-live="polite" className="font-medium text-foreground">Image {activeIndex + 1} of {images.length}</span>
          <span className="min-w-0 flex-1 truncate text-end text-muted-foreground">{activeAlt}</span>
        </div>
      </div>

      {images.length > 1 ? (
        <div className="space-y-2" role="group" aria-label="Image navigation">
          <div className="flex items-center justify-between gap-2">
            <Button type="button" size="sm" variant="outline" onClick={previousImage} disabled={activeIndex === 0} aria-label="Previous image">Previous image</Button>
            <Button type="button" size="sm" variant="outline" onClick={nextImage} disabled={activeIndex === images.length - 1} aria-label="Next image">Next image</Button>
          </div>
          <div className="flex max-w-full gap-2 overflow-x-auto px-1 py-1 sm:justify-center" role="group" aria-label="Image thumbnails">
            {images.map((image, index) => (
              <button
                key={image.id}
                type="button"
                onClick={() => selectImage(index)}
                aria-label={`Show image ${index + 1}`}
                aria-pressed={index === activeIndex}
                className={`flex h-16 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-black p-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${index === activeIndex ? "border-accent ring-2 ring-accent/30" : "border-border hover:border-accent/60"}`}
              >
                {supportedMimeTypes.has(image.mimeType.toLowerCase()) && !failedImageIds.has(image.id)
                  ? <img src={image.url} alt="" aria-hidden="true" onError={() => onImageError(image)} className="max-h-full max-w-full object-contain" />
                  : <span className="px-1 text-center text-[10px] text-white">Image unavailable</span>}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <Dialog open={viewerOpen} onClose={() => setViewerOpen(false)}>
        <DialogContent
          maxWidth="calc(100vw - 32px)"
          scrollable={false}
          aria-label="Teaching image viewer"
          className="!flex !h-[calc(100dvh-32px)] !max-h-[calc(100vh-32px)] !flex-col !overflow-hidden !p-3 sm:!p-5"
        >
          <DialogHeader closeLabel="Close image viewer" className="shrink-0">
            <DialogTitle>Image viewer</DialogTitle>
            <DialogDescription aria-live="polite">Image {activeIndex + 1} / {images.length} · {activeAlt}</DialogDescription>
          </DialogHeader>
          <div
            className="relative flex min-h-0 flex-1 touch-pan-y items-center justify-center overflow-hidden rounded-lg bg-black"
            data-testid="teaching-image-stage"
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            onDoubleClick={() => { setZoom(zoom > 1 ? 1 : 2); setPan({ x: 0, y: 0 }); setIsDragging(false); dragStart.current = null; }}
            style={{ touchAction: zoom > 1 ? "none" : "pan-y", cursor: zoom > 1 ? "grab" : "zoom-in" }}
          >
            {activeFailed ? (
              <p role="alert" className="max-w-sm px-5 text-center text-sm text-white">This Teaching image could not be loaded. You can continue with the question.</p>
            ) : (
              <img
                key={activeImage.id}
                src={activeImage.url}
                alt={activeAlt}
                onLoad={() => onImageLoad(activeImage)}
                onError={() => onImageError(activeImage)}
                draggable={false}
                className="h-full w-full select-none object-contain"
                style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "center", transition: isDragging ? "none" : "transform 120ms ease-out" }}
              />
            )}
            {activeLoading ? <span role="status" className="absolute bottom-3 rounded bg-black/70 px-3 py-2 text-xs text-white">Loading image…</span> : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 pt-3" role="group" aria-label="Image viewer controls">
            {images.length > 1 ? <Button type="button" size="sm" variant="outline" onClick={previousImage} disabled={activeIndex === 0}>Previous</Button> : null}
            <Button type="button" size="sm" variant="outline" onClick={() => changeZoom(1 / 1.25)} disabled={zoom <= 1} aria-label="Zoom out">Zoom −</Button>
            <Button type="button" size="sm" variant="secondary" onClick={resetTransform} aria-label="Fit image">Fit</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => changeZoom(1.25)} disabled={zoom >= maximumZoom} aria-label="Zoom in">Zoom +</Button>
            {images.length > 1 ? <Button type="button" size="sm" variant="outline" onClick={nextImage} disabled={activeIndex === images.length - 1}>Next</Button> : null}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function TeachingImageViewer({ images, resetKey }: { images: TeachingImage[]; resetKey: number }) {
  if (images.length === 0) return null;
  return <TeachingImageViewerState key={resetKey} images={images} />;
}
