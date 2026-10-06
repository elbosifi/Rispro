import { useEffect, useMemo, useRef, useState } from "react";
import type { TeachingAnatomyModality, TeachingAnatomyPlane } from "../api/teaching-api";
import { anatomyCrosshairPixel, anatomyPlaneIndexFromWorldPoint, anatomyWorldPointFromPlanePixel, anatomyWorldPointOnPlaneAtIndex, getAnatomyPlaneSpec, type ParsedAnatomyNrrd, type ReslicedAnatomyPlane } from "./anatomy-nrrd";
import { openAnatomyResliceSession } from "./anatomy-reslice-client";

type DisplayPreset = { id: string; label: string; windowLevel?: { width: number; level: number }; intensityRange?: { min: number; max: number } };
interface Props {
  primary: ParsedAnatomyNrrd;
  segmentation: ParsedAnatomyNrrd | null;
  modality: Exclude<TeachingAnatomyModality, "3D">;
  display?: { windowLevel?: { width: number; level: number }; intensityRange?: { min: number; max: number }; displayPresets?: DisplayPreset[] };
  plane: TeachingAnatomyPlane;
  worldPointLps: [number, number, number];
  onWorldPointLpsChange: (point: [number, number, number]) => void;
  selectedLabel: number | null;
  selectedColor: string | null;
  overlayEnabled: boolean;
}

function rgb(color: string | null): [number, number, number] {
  return !color ? [255, 206, 84] : [1, 3, 5].map((index) => Number.parseInt(color.slice(index, index + 2), 16)) as [number, number, number];
}

function defaultRange(volume: ParsedAnatomyNrrd) {
  const data: number[] = [];
  const stop = Math.min(100_000, volume.data.length);
  for (let index = 0; index < stop; index += 1) data.push(Number(volume.data[index]) * volume.slope + volume.intercept);
  data.sort((left, right) => left - right);
  return { min: data[Math.floor(data.length * 0.02)] ?? 0, max: data[Math.floor(data.length * 0.98)] ?? 1 };
}

export function CrossSectionStackViewer({ primary, segmentation, modality, display, plane, worldPointLps, onWorldPointLpsChange, selectedLabel, selectedColor, overlayEnabled }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; moved: boolean; pan: boolean; startPan: [number, number]; startWl: { width: number; level: number }; startRange: { min: number; max: number } } | null>(null);
  const [slice, setSlice] = useState<ReslicedAnatomyPlane | null>(null);
  const initialRange = useMemo(() => display?.intensityRange ?? defaultRange(primary), [display?.intensityRange, primary]);
  const [range, setRange] = useState(initialRange);
  const [wl, setWl] = useState(display?.windowLevel ?? { width: 400, level: 40 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<[number, number]>([0, 0]);
  const [panMode, setPanMode] = useState(false);
  const [frame, setFrame] = useState({ width: 0, height: 0 });
  const index = anatomyPlaneIndexFromWorldPoint(primary.geometry, plane, worldPointLps);
  const spec = getAnatomyPlaneSpec(primary.geometry, plane);
  const color = rgb(selectedColor);
  const presets = display?.displayPresets ?? [];
  const imageDimensions = useMemo(() => {
    if (!frame.width || !frame.height) return { width: 0, height: 0 };
    const ratio = spec.width / spec.height;
    const width = Math.min(frame.width, frame.height * ratio);
    return { width, height: width / ratio };
  }, [frame, spec.height, spec.width]);

  useEffect(() => {
    // Sessions are shared between the three views; cancelled requests never publish stale slices.
    const session = openAnatomyResliceSession(primary, segmentation);
    const cancel = session.requestSlice(plane, index, setSlice);
    return () => { cancel(); session.release(); };
  }, [primary, segmentation, plane, index]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(([entry]) => setFrame({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: false });
    if (!canvas || !context || !slice) return;
    canvas.width = slice.width;
    canvas.height = slice.height;
    const image = context.createImageData(slice.width, slice.height);
    const low = modality === "CT" ? wl.level - wl.width / 2 : range.min;
    const high = modality === "CT" ? wl.level + wl.width / 2 : range.max;
    for (let index = 0; index < slice.values.length; index += 1) {
      const offset = index * 4;
      if (!slice.validMask[index]) {
        image.data[offset] = 0; image.data[offset + 1] = 0; image.data[offset + 2] = 0; image.data[offset + 3] = 255;
        continue;
      }
      const gray = Math.round(255 * Math.max(0, Math.min(1, (slice.values[index]! - low) / Math.max(0.001, high - low))));
      const selected = overlayEnabled && selectedLabel !== null && slice.labels?.[index] === selectedLabel;
      image.data[offset] = selected ? Math.round(gray * 0.48 + color[0] * 0.52) : gray;
      image.data[offset + 1] = selected ? Math.round(gray * 0.48 + color[1] * 0.52) : gray;
      image.data[offset + 2] = selected ? Math.round(gray * 0.48 + color[2] * 0.52) : gray;
      image.data[offset + 3] = 255;
    }
    context.putImageData(image, 0, 0);
  }, [slice, modality, range, wl, overlayEnabled, selectedLabel, color]);

  const move = (delta: number) => {
    const next = Math.max(0, Math.min(spec.sliceCount - 1, index + delta));
    onWorldPointLpsChange(anatomyWorldPointOnPlaneAtIndex(primary.geometry, plane, next, worldPointLps));
  };
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const handleWheel = (event: WheelEvent) => {
      if (!event.deltaY) return;
      event.preventDefault();
      const next = Math.max(0, Math.min(spec.sliceCount - 1, index + (event.deltaY > 0 ? 1 : -1)));
      onWorldPointLpsChange(anatomyWorldPointOnPlaneAtIndex(primary.geometry, plane, next, worldPointLps));
    };
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, [index, onWorldPointLpsChange, plane, primary.geometry, spec.sliceCount, worldPointLps]);
  const crosshair = anatomyCrosshairPixel(primary.geometry, plane, worldPointLps);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, moved: false, pan: panMode || event.button === 1, startPan: pan, startWl: wl, startRange: range };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) < 3 && !drag.moved) return;
    drag.moved = true;
    if (drag.pan) { setPan([drag.startPan[0] + dx, drag.startPan[1] + dy]); return; }
    if (modality === "CT") setWl({ width: Math.max(1, drag.startWl.width + dx * 4), level: drag.startWl.level - dy * 2 });
    else {
      const startWidth = Math.max(1, drag.startRange.max - drag.startRange.min);
      const width = Math.max(1, startWidth + dx * startWidth * 0.01);
      const center = (drag.startRange.min + drag.startRange.max) / 2 - dy * startWidth * 0.01;
      setRange({ min: center - width / 2, max: center + width / 2 });
    }
  };
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.moved || drag.pan || !imageRef.current) return;
    const rect = imageRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = ((event.clientX - rect.left) / rect.width) * spec.width;
    const y = ((event.clientY - rect.top) / rect.height) * spec.height;
    onWorldPointLpsChange(anatomyWorldPointFromPlanePixel(primary.geometry, plane, index, x, y));
  };

  const resetImage = () => { setZoom(1); setPan([0, 0]); setPanMode(false); };
  const resetDisplay = () => { setWl(display?.windowLevel ?? { width: 400, level: 40 }); setRange(initialRange); };
  const selectPreset = (id: string) => {
    const preset = presets.find((item) => item.id === id);
    if (preset?.windowLevel) setWl(preset.windowLevel);
    if (preset?.intensityRange) setRange(preset.intensityRange);
  };

  return (
    <section className="flex min-h-[18rem] min-w-0 flex-col rounded-xl border bg-[#111827] text-white" style={{ borderColor: "var(--border)" }}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 text-xs" style={{ borderColor: "rgba(255,255,255,.12)" }}>
        <strong>{plane.toUpperCase()} {modality}</strong>
        {presets.length > 0 && <label className="flex items-center gap-1">Preset <select aria-label={`${plane} display preset`} className="max-w-36 rounded bg-slate-800 px-1 py-1" value="" onChange={(event) => selectPreset(event.target.value)}><option value="">Custom</option>{presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label>}
        <span>{modality === "CT" ? `W ${Math.round(wl.width)} L ${Math.round(wl.level)}` : `MRI intensity ${range.min.toFixed(0)} to ${range.max.toFixed(0)}`}</span>
        <button type="button" onClick={resetDisplay}>Reset {modality === "CT" ? "W/L" : "intensity"}</button>
      </header>
      <div ref={viewportRef} tabIndex={0} data-world-point-lps={worldPointLps.join(",")} data-plane-index={index} data-selected-label={selectedLabel ?? "none"} data-overlay-enabled={overlayEnabled} className="relative flex min-h-[14rem] min-w-0 flex-1 items-center justify-center overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-cyan-300" onKeyDown={(event) => { if (["ArrowDown", "ArrowRight"].includes(event.key)) { event.preventDefault(); move(1); } else if (["ArrowUp", "ArrowLeft"].includes(event.key)) { event.preventDefault(); move(-1); } else if (event.key === "+" || event.key === "=") setZoom((value) => Math.min(8, value * 1.2)); else if (event.key === "-") setZoom((value) => Math.max(0.25, value / 1.2)); else if (event.key === "Home") resetImage(); }} aria-label={`${plane} ${modality} radiology view`}>
        <span className="absolute left-2 top-2 z-10 rounded bg-black/60 px-1.5">{spec.leftMarker}</span>
        <span className="absolute right-2 top-2 z-10 rounded bg-black/60 px-1.5">{spec.rightMarker}</span>
        <span className="absolute bottom-2 left-2 z-10 rounded bg-black/60 px-1.5 text-[0.65rem]">{plane.toUpperCase()} · {index + 1}/{spec.sliceCount}</span>
        <div ref={imageRef} className="absolute left-1/2 top-1/2 touch-none" style={{ width: imageDimensions.width, height: imageDimensions.height, transform: `translate(calc(-50% + ${pan[0]}px), calc(-50% + ${pan[1]}px)) scale(${zoom})` }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { dragRef.current = null; }}>
          <canvas ref={canvasRef} className="block h-full w-full" />
          <i aria-hidden="true" className="pointer-events-none absolute h-px bg-cyan-300/80" style={{ left: 0, right: 0, top: `${100 * crosshair.y / spec.height}%` }} />
          <i aria-hidden="true" className="pointer-events-none absolute w-px bg-cyan-300/80" style={{ top: 0, bottom: 0, left: `${100 * crosshair.x / spec.width}%` }} />
        </div>
      </div>
      <footer className="flex flex-wrap items-center gap-2 border-t px-3 py-2 text-xs" style={{ borderColor: "rgba(255,255,255,.12)" }}>
        <button type="button" onClick={() => move(-1)}>Previous slice</button>
        <button type="button" onClick={() => move(1)}>Next slice</button>
        <button type="button" aria-pressed={panMode} onClick={() => setPanMode((active) => !active)}>{panMode ? "Pan on" : "Pan"}</button>
        <button type="button" aria-label={`${plane} zoom out`} onClick={() => setZoom((value) => Math.max(0.25, value / 1.2))}>−</button>
        <span aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label={`${plane} zoom in`} onClick={() => setZoom((value) => Math.min(8, value * 1.2))}>+</button>
        <button type="button" onClick={resetImage}>Reset image</button>
        <span className="ml-auto text-slate-300">{panMode ? "Drag to pan" : `Drag to adjust ${modality === "CT" ? "window/level" : "MRI intensity"}; click to move crosshair`}</span>
      </footer>
    </section>
  );
}
