import { useEffect, useMemo, useRef } from "react";
import type { TeachingAnatomyModality, TeachingAnatomyPlane } from "../api/teaching-api";
import type { AnatomyPlaneSpec, ParsedAnatomyNrrd } from "./anatomy-nrrd";
import { resliceAnatomyPlane } from "./anatomy-nrrd";

interface CrossSectionStackViewerProps {
  primary: ParsedAnatomyNrrd;
  segmentation: ParsedAnatomyNrrd | null;
  modality: Exclude<TeachingAnatomyModality, "3D">;
  display?: { windowLevel?: { width: number; level: number }; intensityRange?: { min: number; max: number } };
  plane: TeachingAnatomyPlane;
  supportedPlanes: TeachingAnatomyPlane[];
  planeSpec: AnatomyPlaneSpec;
  sliceIndex: number;
  onPlaneChange: (plane: TeachingAnatomyPlane) => void;
  onSliceChange: (sliceIndex: number) => void;
  selectedLabel: number | null;
  selectedColor: string | null;
  overlayEnabled: boolean;
}

function colorChannels(color: string | null): [number, number, number] {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return [255, 206, 84];
  return [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16)) as [number, number, number];
}

function estimatedIntensityRange(volume: ParsedAnatomyNrrd): { min: number; max: number } {
  const stride = Math.max(1, Math.floor(volume.data.length / 200_000));
  const sample: number[] = [];
  for (let index = 0; index < volume.data.length; index += stride) {
    const value = Number(volume.data[index]) * volume.slope + volume.intercept;
    if (Number.isFinite(value) && value !== 0) sample.push(value);
  }
  if (sample.length === 0) return { min: 0, max: 1 };
  sample.sort((left, right) => left - right);
  const min = sample[Math.floor((sample.length - 1) * 0.02)]!;
  const max = sample[Math.floor((sample.length - 1) * 0.98)]!;
  return max > min ? { min, max } : { min: min - 0.5, max: max + 0.5 };
}

export function CrossSectionStackViewer({ primary, segmentation, modality, display, plane, supportedPlanes, planeSpec, sliceIndex, onPlaneChange, onSliceChange, selectedLabel, selectedColor, overlayEnabled }: CrossSectionStackViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const intensityRange = useMemo(() => display?.intensityRange ?? estimatedIntensityRange(primary), [display?.intensityRange, primary]);
  const [red, green, blue] = colorChannels(selectedColor);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: false });
    if (!canvas || !context) return;
    const resliced = resliceAnatomyPlane(primary, segmentation, plane, sliceIndex);
    canvas.width = resliced.width;
    canvas.height = resliced.height;
    const image = context.createImageData(resliced.width, resliced.height);
    const output = image.data;
    const ctWidth = display?.windowLevel?.width ?? 400;
    const ctLevel = display?.windowLevel?.level ?? 40;
    const low = modality === "CT" ? ctLevel - ctWidth / 2 : intensityRange.min;
    const high = modality === "CT" ? ctLevel + ctWidth / 2 : intensityRange.max;
    for (let index = 0; index < resliced.values.length; index += 1) {
      const value = resliced.values[index]!;
      const gray = Math.round(255 * Math.max(0, Math.min(1, (value - low) / (high - low))));
      const targetIndex = 4 * index;
      if (overlayEnabled && selectedLabel !== null && resliced.labels?.[index] === selectedLabel) {
        output[targetIndex] = Math.round(gray * 0.48 + red * 0.52);
        output[targetIndex + 1] = Math.round(gray * 0.48 + green * 0.52);
        output[targetIndex + 2] = Math.round(gray * 0.48 + blue * 0.52);
      } else {
        output[targetIndex] = gray;
        output[targetIndex + 1] = gray;
        output[targetIndex + 2] = gray;
      }
      output[targetIndex + 3] = 255;
    }
    context.putImageData(image, 0, 0);
  }, [primary, segmentation, plane, sliceIndex, selectedLabel, red, green, blue, overlayEnabled, display, modality, intensityRange]);

  const changeSlice = (delta: number) => onSliceChange(Math.max(0, Math.min(planeSpec.sliceCount - 1, sliceIndex + delta)));
  const planeName = `${plane[0]!.toLocaleUpperCase()}${plane.slice(1)}`;
  const imageLabel = `${planeName} ${modality} slice ${sliceIndex + 1}`;
  return (
    <section aria-labelledby="cross-section-title" className="flex min-h-[30rem] min-w-0 flex-col rounded-xl border bg-[#111827] text-white" style={{ borderColor: "var(--border)" }}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "rgba(255,255,255,.12)" }}>
        <div>
          <h2 id="cross-section-title" className="text-sm font-semibold">{planeName} {modality}</h2>
          <p className="text-xs text-slate-300">{modality === "CT" ? `W ${display?.windowLevel?.width ?? 400} · L ${display?.windowLevel?.level ?? 40}` : "MRI intensity display"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Cross-section plane">
          {supportedPlanes.map((supportedPlane) => <button key={supportedPlane} type="button" aria-pressed={plane === supportedPlane} onClick={() => onPlaneChange(supportedPlane)} className={`rounded px-2 py-1 text-xs ${plane === supportedPlane ? "bg-sky-700 font-semibold text-white" : "text-slate-300 hover:bg-white/10"}`}>{supportedPlane[0]!.toLocaleUpperCase()}{supportedPlane.slice(1)}</button>)}
        </div>
        <span className="rounded-md bg-slate-700 px-2 py-1 text-xs tabular-nums" aria-live="polite">Slice {sliceIndex + 1} of {planeSpec.sliceCount}</span>
      </header>
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-2 py-3"
        tabIndex={0}
        aria-label={`${planeName} ${modality} stack. Use the mouse wheel or arrow keys to change slices.`}
        onWheel={(event) => { event.preventDefault(); changeSlice(event.deltaY > 0 ? 1 : -1); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowRight") { event.preventDefault(); changeSlice(1); }
          if (event.key === "ArrowUp" || event.key === "ArrowLeft") { event.preventDefault(); changeSlice(-1); }
        }}
      >
        <span className="absolute left-3 top-3 z-10 rounded bg-black/60 px-2 py-1 text-sm font-bold" aria-label={`Patient ${planeSpec.leftMarker}`}>{planeSpec.leftMarker}</span>
        <span className="absolute right-3 top-3 z-10 rounded bg-black/60 px-2 py-1 text-sm font-bold" aria-label={`Patient ${planeSpec.rightMarker}`}>{planeSpec.rightMarker}</span>
        <canvas ref={canvasRef} aria-label={imageLabel} className="max-h-[24rem] max-w-full object-contain" style={{ aspectRatio: `${planeSpec.width * planeSpec.spacingX} / ${planeSpec.height * planeSpec.spacingY}` }} />
      </div>
      <div className="border-t px-4 py-3" style={{ borderColor: "rgba(255,255,255,.12)" }}>
        <input aria-label={`${planeName} slice`} type="range" min={0} max={planeSpec.sliceCount - 1} step={1} value={sliceIndex} onChange={(event) => onSliceChange(Number(event.currentTarget.value))} className="w-full accent-sky-400" />
      </div>
    </section>
  );
}
