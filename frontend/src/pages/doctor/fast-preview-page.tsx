import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "@/lib/api-client";

type Series = { id: string; description: string; number: string | null; modality: string | null; count: number };
type Study = { description: string | null; date: string | null; accessionNumber: string; patientName: string | null };
type Preview = { study: Study; series: Series[]; settings: { quality: number; maximumWidth: number } };
type Slice = { id: string; number: number };
type Frame = { url: string; error?: never } | { url?: never; error: string };
const emptySlices: Slice[] = [];
const presets: Record<string, { center: number; width: number }> = {
  Brain: { center: 40, width: 80 }, Lung: { center: -600, width: 1500 },
  "Soft Tissue": { center: 40, width: 400 }, Bone: { center: 300, width: 1500 },
};

export function FastPreviewPage() {
  const { appointmentId = "" } = useParams();
  const base = `/doctor/reporting-board/cases/${encodeURIComponent(appointmentId)}/fast-preview`;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [seriesId, setSeriesId] = useState("");
  const [stack, setStack] = useState<{ key: string; slices: Slice[] } | null>(null);
  const [index, setIndex] = useState(0);
  const [windowName, setWindowName] = useState("dicom");
  const [batch, setBatch] = useState<{ key: string; frames: (Frame | undefined)[] } | null>(null);
  const [displayed, setDisplayed] = useState<{ key: string; index: number; url: string } | null>(null);
  const [error, setError] = useState("");
  const viewport = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ id: number; y: number } | null>(null);
  const stackKey = `${base}/series/${encodeURIComponent(seriesId)}`;
  const imageKey = `${stackKey}/${windowName}`;
  const slices = stack?.key === stackKey ? stack.slices : emptySlices;
  const frame = batch?.key === imageKey ? batch.frames[index] : undefined;
  const image = frame?.url ? { index, url: frame.url } : displayed?.key === imageKey ? displayed : null;
  const loaded = batch?.key === imageKey ? batch.frames.filter((item) => item?.url).length : 0;
  const failed = batch?.key === imageKey ? batch.frames.filter((item) => item?.error).length : 0;
  const selectedSeries = preview?.series.find((item) => item.id === seriesId);

  useEffect(() => {
    const elements = [document.documentElement, document.body];
    const previous = elements.map((element) => element.style.overflow);
    elements.forEach((element) => { element.style.overflow = "hidden"; });
    return () => elements.forEach((element, i) => { element.style.overflow = previous[i]; });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    api<Preview>(base, { signal: controller.signal }).then((data) => {
      if (controller.signal.aborted) return;
      setPreview(data);
      setSeriesId(data.series.find((item) => item.modality === "CT" || item.modality === "MR")?.id ?? "");
      setIndex(0);
      setDisplayed(null);
      setWindowName("dicom");
    }).catch((err: Error) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [base]);

  useEffect(() => {
    if (!seriesId) return;
    const controller = new AbortController();
    setError("");
    api<{ instances: Slice[] }>(stackKey, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      setStack({ key: stackKey, slices: result.instances });
      if (!result.instances.length) setError("This series contains no images.");
    }).catch((err: Error) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [stackKey, seriesId]);

  useEffect(() => {
    if (!slices.length) return;
    const controller = new AbortController();
    const urls: string[] = [];
    const windowLevel = presets[windowName];
    const suffix = windowLevel ? `?center=${windowLevel.center}&width=${windowLevel.width}` : "";
    const frames: (Frame | undefined)[] = Array(slices.length);
    let next = 0;
    setBatch({ key: imageKey, frames: [...frames] });

    // Keep the full selected series decoded, with four requests at a time.
    // Navigating images never cancels the batch or discards loaded images.
    async function loadSeries() {
      while (!controller.signal.aborted && next < slices.length) {
        const position = next++;
        let url = "";
        try {
          const response = await fetch(`/api${base}/images/${encodeURIComponent(slices[position].id)}${suffix}`, {
            credentials: "include", cache: "no-store", signal: controller.signal,
          });
          if (!response.ok) throw new Error(response.status === 415
            ? "This image is unsupported. Fast Preview supports conventional single-frame CT and MRI only."
            : `Could not load image (${response.status}).`);
          const blob = await response.blob();
          if (controller.signal.aborted) return;
          url = URL.createObjectURL(blob);
          const decoded = new Image();
          decoded.src = url;
          await decoded.decode();
          if (controller.signal.aborted) { URL.revokeObjectURL(url); return; }
          urls.push(url);
          frames[position] = { url };
        } catch (err) {
          if (url) URL.revokeObjectURL(url);
          if (controller.signal.aborted) return;
          frames[position] = { error: err instanceof Error ? err.message : "Could not load image." };
        }
        setBatch({ key: imageKey, frames: [...frames] });
      }
    }
    for (let worker = 0; worker < Math.min(4, slices.length); worker++) void loadSeries();
    return () => {
      controller.abort();
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [base, slices, imageKey, windowName]);

  useEffect(() => {
    if (frame?.url) setDisplayed({ key: imageKey, index, url: frame.url });
  }, [frame, imageKey, index]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    // React delegates wheel events passively. A native listener prevents the
    // same gesture from also scrolling the page, even at either series boundary.
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      event.preventDefault();
      if (event.deltaY) setIndex((value) => Math.max(0, Math.min(Math.max(0, slices.length - 1), value + (event.deltaY > 0 ? 1 : -1))));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [slices.length]);

  const step = (delta: number) => setIndex((value) => Math.max(0, Math.min(Math.max(0, slices.length - 1), value + delta)));
  const message = error || (frame?.error ? `${image ? "Showing the previous image. " : ""}${frame.error}` : "");

  return <main className="fixed inset-0 flex h-dvh flex-col overflow-hidden overscroll-none bg-slate-950 text-white">
    <header className="shrink-0 space-y-2 border-b border-slate-800 bg-slate-950 px-3 py-2 sm:px-5 sm:py-3">
      <div className="flex min-w-0 items-center justify-between gap-2 text-xs">
        <h1 className="shrink-0 text-sm font-semibold tracking-wide">Fast Preview</h1>
        <span className="rounded-full border border-amber-300/20 bg-amber-300/10 px-2 py-0.5 text-[10px] font-medium text-amber-200">Non-diagnostic preview</span>
      </div>
      <div className="flex min-w-0 gap-2">
        <label className="grid min-w-0 flex-1 gap-1 text-xs text-slate-300">Series
          <select aria-label="Series" className="h-11 w-full min-w-0 rounded border border-slate-700 bg-slate-800 px-2 text-sm text-white" value={seriesId} onChange={(event) => { setSeriesId(event.target.value); setWindowName("dicom"); setIndex(0); setDisplayed(null); }}>
            <option value="">Select series</option>
            {preview?.series.map((item) => <option key={item.id} value={item.id} disabled={item.modality !== "CT" && item.modality !== "MR"}>
              {item.number ? `${item.number} · ` : ""}{item.description} ({item.modality || "unknown"}, {item.count}){item.modality !== "CT" && item.modality !== "MR" ? " — unsupported" : ""}
            </option>)}
          </select>
        </label>
        <label className="grid w-32 shrink-0 gap-1 text-xs text-slate-300 sm:w-40">Window
          <select aria-label="Window" className="h-11 w-full rounded border border-slate-700 bg-slate-800 px-2 text-sm text-white" value={windowName} onChange={(event) => { setWindowName(event.target.value); setDisplayed(null); }}>
            <option value="dicom">Original</option>
            {selectedSeries?.modality === "CT" && Object.keys(presets).map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      </div>
    </header>
    <div ref={viewport} role="region" aria-label="Image viewer" aria-describedby="preview-navigation" tabIndex={0}
      className="relative min-h-0 flex-1 overflow-hidden overscroll-none bg-black touch-none outline-offset-[-2px]"
      onKeyDown={(event) => {
        if (["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          if (event.key === "Home") setIndex(0);
          else if (event.key === "End") setIndex(Math.max(0, slices.length - 1));
          else step(event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1);
        }
      }}
      onPointerDown={(event) => {
        if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
        pointer.current = { id: event.pointerId, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.focus({ preventScroll: true });
      }}
      onPointerMove={(event) => {
        const last = pointer.current;
        if (!last || last.id !== event.pointerId) return;
        const distance = event.clientY - last.y;
        if (Math.abs(distance) >= 20) {
          step(-Math.trunc(distance / 20));
          pointer.current = { ...last, y: event.clientY - distance % 20 };
        }
      }}
      onPointerUp={() => { pointer.current = null; }} onPointerCancel={() => { pointer.current = null; }} onLostPointerCapture={() => { pointer.current = null; }}>
      {image ? <img src={image.url} alt="Non-diagnostic study preview" draggable={false} className="absolute inset-0 h-full w-full select-none object-contain" />
        : <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-slate-400">{error ? "Preview unavailable" : seriesId ? "Loading images…" : preview ? "Select a supported series" : "Loading study…"}</div>}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 space-y-1 bg-gradient-to-t from-black/90 to-transparent p-3 pt-8 text-center text-xs text-slate-300">
        {message && <p role="alert" className="text-amber-300">{message}</p>}
        <p role="status">{image ? image.index + 1 : 0} / {slices.length}{slices.length > 0 && (loaded + failed < slices.length ? ` · Loading series ${loaded} / ${slices.length}` : failed ? ` · ${failed} image${failed === 1 ? "" : "s"} unavailable` : " · Series loaded")}{image && !frame && " · Loading image…"}</p>
        <p id="preview-navigation">Scroll, swipe up/down, or use arrow keys to browse</p>
      </div>
    </div>
  </main>;
}
