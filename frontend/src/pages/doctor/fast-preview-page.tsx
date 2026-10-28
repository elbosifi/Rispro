import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Button, Input } from "@/components/shared";
import { api } from "@/lib/api-client";

type Series = { id: string; description: string; number: string | null; modality: string | null; count: number };
type Study = { description: string | null; date: string | null; accessionNumber: string; patientName: string | null };
type Preview = { study: Study; series: Series[]; settings: { quality: number; maximumWidth: number } };
type Slice = { id: string; number: number };
type WindowLevel = { center: number; width: number };
const presets: Record<string, WindowLevel> = { Brain: { center: 40, width: 80 }, Lung: { center: -600, width: 1500 }, "Soft Tissue": { center: 40, width: 400 }, Bone: { center: 300, width: 1500 } };

export function FastPreviewPage() {
  const { appointmentId = "" } = useParams();
  const base = `/doctor/reporting-board/cases/${encodeURIComponent(appointmentId)}/fast-preview`;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [seriesId, setSeriesId] = useState("");
  const [slices, setSlices] = useState<Slice[]>([]);
  const [index, setIndex] = useState(0);
  const [displayedIndex, setDisplayedIndex] = useState<number | null>(null);
  const [windowLevel, setWindowLevel] = useState<WindowLevel | null>(null);
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [activeSettings, setActiveSettings] = useState<{ quality: number; maximumWidth: number } | null>(null);
  const cache = useRef(new Map<string, { url: string; settings: { quality: number; maximumWidth: number } | null }>());
  const currentImage = useRef("");
  const pointer = useRef<{ x: number; y: number; type: string } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api<Preview>(base, { signal: controller.signal }).then((data) => { setPreview(data); setActiveSettings(data.settings); setSeriesId(data.series.find((item) => item.modality === "CT" || item.modality === "MR")?.id ?? ""); }).catch((err: Error) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [base]);

  useEffect(() => {
    if (!seriesId) return;
    const controller = new AbortController();
    setSlices([]); setIndex(0); setDisplayedIndex(null); setImage(""); currentImage.current = ""; setLoading(false); setError("");
    for (const entry of cache.current.values()) URL.revokeObjectURL(entry.url);
    cache.current.clear();
    api<{ instances: Slice[] }>(`${base}/series/${encodeURIComponent(seriesId)}`, { signal: controller.signal }).then((result) => { setSlices(result.instances); if (!result.instances.length) setError("This series contains no images."); }).catch((err: Error) => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [base, seriesId]);

  useEffect(() => {
    const selected = slices[index];
    if (!selected) return;
    const controller = new AbortController();
    const suffix = windowLevel ? `?center=${encodeURIComponent(windowLevel.center)}&width=${encodeURIComponent(windowLevel.width)}` : "";
    const key = (slice: Slice) => `${slice.id}${suffix}`;
    async function load(slice: Slice) {
      const existing = cache.current.get(key(slice));
      if (existing) return existing;
      const response = await fetch(`/api${base}/images/${encodeURIComponent(slice.id)}${suffix}`, { credentials: "include", cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 415 ? "This image is unsupported. Fast Preview supports conventional single-frame CT and MRI only." : `Could not load image (${response.status}).`);
      const blob = await response.blob();
      if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
      const objectUrl = URL.createObjectURL(blob);
      try {
        const decoded = new Image();
        decoded.src = objectUrl;
        await decoded.decode();
        if (controller.signal.aborted) throw new DOMException("Cancelled", "AbortError");
      } catch (error) { URL.revokeObjectURL(objectUrl); throw error; }
      const q = Number(response.headers.get("X-Fast-Preview-Quality"));
      const w = Number(response.headers.get("X-Fast-Preview-Width"));
      const entry = { url: objectUrl, settings: q && w ? { quality: q, maximumWidth: w } : null };
      cache.current.set(key(slice), entry);
      return entry;
    }
    setLoading(true); setError("");
    void load(selected).then((entry) => {
      if (controller.signal.aborted) return;
      const previousImage = currentImage.current;
      currentImage.current = entry.url; setImage(entry.url); setDisplayedIndex(index); if (entry.settings) setActiveSettings(entry.settings); setLoading(false);
      const keep = new Set([key(selected), ...[slices[index - 1], slices[index + 1]].filter((slice): slice is Slice => Boolean(slice)).map(key)]);
      for (const [cachedKey, cached] of cache.current) if (!keep.has(cachedKey) && cached.url !== entry.url && cached.url !== previousImage) { URL.revokeObjectURL(cached.url); cache.current.delete(cachedKey); }
      for (const slice of [slices[index - 1], slices[index + 1]]) if (slice) void load(slice).catch(() => undefined);
    }).catch((err: Error) => { if (!controller.signal.aborted) { setLoading(false); setError(`${currentImage.current ? "Showing the previous image. " : ""}${err.message}`); } });
    return () => controller.abort();
  }, [base, slices, index, windowLevel]);

  useEffect(() => () => { for (const entry of cache.current.values()) URL.revokeObjectURL(entry.url); cache.current.clear(); }, []);
  const step = (delta: number) => setIndex((value) => Math.max(0, Math.min(slices.length - 1, value + delta)));
  const selectedSeries = preview?.series.find((item) => item.id === seriesId);
  const currentWindow = windowLevel ?? { center: 40, width: 400 };
  return <main className="min-h-screen bg-slate-950 text-white p-3 md:p-5 space-y-3">
    <header className="flex flex-wrap items-center justify-between gap-2"><div><h1 className="text-xl font-semibold">Fast Preview <span className="text-amber-300 text-sm">Non-diagnostic preview</span></h1>{preview && <p className="text-sm text-slate-300">{preview.study.patientName} · {preview.study.accessionNumber} · {preview.study.description || "Study"} · {preview.study.date || ""}</p>}</div>{activeSettings && <p className="text-xs text-slate-400">JPEG quality {activeSettings.quality} · max width {activeSettings.maximumWidth} px</p>}</header>
    <div className="rounded bg-slate-100 p-3 text-slate-900 space-y-3"><div className="flex flex-wrap items-end gap-2">
      <label className="grid gap-1 text-sm">Series<select aria-label="Series" className="rounded bg-slate-800 p-2 text-white" value={seriesId} onChange={(event) => { setSeriesId(event.target.value); setWindowLevel(null); setZoom(1); setPan({ x: 0, y: 0 }); }}><option value="">Select series</option>{preview?.series.map((item) => <option key={item.id} value={item.id}>{item.number ? `${item.number} · ` : ""}{item.description} ({item.modality || "unknown"}, {item.count}){item.modality !== "CT" && item.modality !== "MR" ? " — unsupported" : ""}</option>)}</select></label>
      <Button variant="secondary" size="sm" onClick={() => setZoom((value) => Math.max(.25, value / 1.25))}>−</Button><span className="text-sm">{Math.round(zoom * 100)}%</span><Button variant="secondary" size="sm" onClick={() => setZoom((value) => Math.min(8, value * 1.25))}>+</Button><Button variant="secondary" size="sm" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>Fit</Button>
      {selectedSeries?.modality === "CT" && Object.entries(presets).map(([name, value]) => <Button key={name} variant="secondary" size="sm" onClick={() => setWindowLevel(value)}>{name}</Button>)}
      <Button variant="secondary" size="sm" onClick={() => setWindowLevel(null)}>DICOM window</Button>
    </div>
    <div className="flex flex-wrap gap-3 text-sm"><label>Window center <Input className="w-28 text-slate-900" type="number" value={currentWindow.center} onChange={(event) => setWindowLevel({ ...currentWindow, center: Number(event.target.value) })} /><input aria-label="Adjust window center" type="range" min={-2000} max={2000} value={Math.max(-2000, Math.min(2000, currentWindow.center))} onChange={(event) => setWindowLevel({ ...currentWindow, center: Number(event.target.value) })} /></label><label>Window width <Input className="w-28 text-slate-900" type="number" min={1} value={currentWindow.width} onChange={(event) => setWindowLevel({ ...currentWindow, width: Math.max(1, Number(event.target.value)) })} /><input aria-label="Adjust window width" type="range" min={1} max={4000} value={Math.min(4000, currentWindow.width)} onChange={(event) => setWindowLevel({ ...currentWindow, width: Number(event.target.value) })} /></label><span className="self-center text-slate-700">Wheel or swipe: slices · drag with mouse: pan</span></div></div>
    {error && <p role="alert" className="text-amber-300">{error}</p>}
    <div className="relative flex h-[65vh] min-h-72 items-center justify-center overflow-hidden bg-black touch-none" onWheel={(event) => { event.preventDefault(); step(event.deltaY > 0 ? 1 : -1); }} onPointerDown={(event) => { pointer.current = { x: event.clientX, y: event.clientY, type: event.pointerType }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { const last = pointer.current; if (!last) return; const dx = event.clientX - last.x, dy = event.clientY - last.y; if (last.type === "touch") { if (Math.abs(dy) >= 20) { step(dy > 0 ? 1 : -1); pointer.current = { ...last, x: event.clientX, y: event.clientY }; } } else { setPan((value) => ({ x: value.x + dx, y: value.y + dy })); pointer.current = { ...last, x: event.clientX, y: event.clientY }; } }} onPointerUp={() => { pointer.current = null; }} onPointerCancel={() => { pointer.current = null; }}>
      {image ? <img src={image} alt="Non-diagnostic study preview" draggable={false} className="max-h-full max-w-full object-contain select-none" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }} /> : <span className="text-slate-400">{loading ? "Loading image…" : "Select a supported series"}</span>}
      {loading && image && <span className="absolute top-2 right-2 bg-slate-800 px-2 text-sm">Loading…</span>}
    </div>
    <div className="flex items-center gap-3 rounded bg-slate-100 p-2 text-slate-900"><Button variant="secondary" size="sm" onClick={() => step(-1)} disabled={index <= 0}>Previous</Button><span className="text-sm whitespace-nowrap">{displayedIndex === null ? 0 : displayedIndex + 1} / {slices.length}</span><Button variant="secondary" size="sm" onClick={() => step(1)} disabled={index >= slices.length - 1}>Next</Button><input aria-label="Slice" className="min-w-0 flex-1" type="range" min={0} max={Math.max(0, slices.length - 1)} value={index} onChange={(event) => setIndex(Number(event.target.value))} disabled={!slices.length} /></div>
  </main>;
}
