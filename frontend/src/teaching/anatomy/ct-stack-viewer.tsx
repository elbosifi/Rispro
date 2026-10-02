import { useEffect, useRef } from "react";
import type { ParsedAnatomyNrrd } from "./anatomy-nrrd";
import { orientationMarkers } from "./anatomy-nrrd";

interface CtStackViewerProps {
  ct: ParsedAnatomyNrrd;
  segmentation: ParsedAnatomyNrrd;
  sliceIndex: number;
  onSliceChange: (sliceIndex: number) => void;
  selectedLabel: number | null;
  selectedColor: string | null;
  overlayEnabled: boolean;
}

function colorChannels(color: string | null): [number, number, number] {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return [255, 206, 84];
  return [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16)) as [number, number, number];
}

export function CtStackViewer({ ct, segmentation, sliceIndex, onSliceChange, selectedLabel, selectedColor, overlayEnabled }: CtStackViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markers = orientationMarkers(ct.geometry);
  const [red, green, blue] = colorChannels(selectedColor);
  const width = ct.geometry.sizes[0];
  const height = ct.geometry.sizes[1];
  const depth = ct.geometry.sizes[2];

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d", { alpha: false });
    if (!canvas || !context) return;
    canvas.width = width;
    canvas.height = height;
    const image = context.createImageData(width, height);
    const output = image.data;
    const widthWindow = 400;
    const level = 40;
    const low = level - widthWindow / 2;
    const high = level + widthWindow / 2;
    for (let y = 0; y < height; y += 1) {
      const sourceY = markers.flipY ? height - 1 - y : y;
      for (let x = 0; x < width; x += 1) {
        const sourceX = markers.flipX ? width - 1 - x : x;
        const sourceIndex = sourceX + width * (sourceY + height * sliceIndex);
        const value = Number(ct.data[sourceIndex]) * ct.slope + ct.intercept;
        const gray = Math.round(255 * Math.max(0, Math.min(1, (value - low) / (high - low))));
        const targetIndex = 4 * (x + width * y);
        let outRed = gray;
        let outGreen = gray;
        let outBlue = gray;
        if (overlayEnabled && selectedLabel !== null && Number(segmentation.data[sourceIndex]) === selectedLabel) {
          outRed = Math.round(gray * 0.48 + red * 0.52);
          outGreen = Math.round(gray * 0.48 + green * 0.52);
          outBlue = Math.round(gray * 0.48 + blue * 0.52);
        }
        output[targetIndex] = outRed;
        output[targetIndex + 1] = outGreen;
        output[targetIndex + 2] = outBlue;
        output[targetIndex + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
  }, [ct, segmentation, sliceIndex, selectedLabel, red, green, blue, overlayEnabled, width, height, markers.flipX, markers.flipY]);

  const changeSlice = (delta: number) => onSliceChange(Math.max(0, Math.min(depth - 1, sliceIndex + delta)));
  return (
    <section aria-labelledby="ct-stack-title" className="flex min-h-[30rem] min-w-0 flex-col rounded-xl border bg-[#111827] text-white" style={{ borderColor: "var(--border)" }}>
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "rgba(255,255,255,.12)" }}>
        <div>
          <h2 id="ct-stack-title" className="text-sm font-semibold">Axial CT</h2>
          <p className="text-xs text-slate-300">W 400 · L 40</p>
        </div>
        <span className="rounded-md bg-slate-700 px-2 py-1 text-xs tabular-nums" aria-live="polite">Slice {sliceIndex + 1} of {depth}</span>
      </header>
      <div
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-2 py-3"
        tabIndex={0}
        aria-label="Axial CT stack. Use the mouse wheel or up and down arrow keys to change slices."
        onWheel={(event) => { event.preventDefault(); changeSlice(event.deltaY > 0 ? 1 : -1); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowRight") { event.preventDefault(); changeSlice(1); }
          if (event.key === "ArrowUp" || event.key === "ArrowLeft") { event.preventDefault(); changeSlice(-1); }
        }}
      >
        <span className="absolute left-3 top-3 z-10 rounded bg-black/60 px-2 py-1 text-sm font-bold" aria-label="Patient right">{markers.left}</span>
        <span className="absolute right-3 top-3 z-10 rounded bg-black/60 px-2 py-1 text-sm font-bold" aria-label="Patient left">{markers.right}</span>
        <canvas ref={canvasRef} aria-label={`Axial CT slice ${sliceIndex + 1}`} className="max-h-[24rem] max-w-full object-contain" />
      </div>
      <div className="border-t px-4 py-3" style={{ borderColor: "rgba(255,255,255,.12)" }}>
        <input
          aria-label="CT slice"
          type="range"
          min={0}
          max={depth - 1}
          step={1}
          value={sliceIndex}
          onChange={(event) => onSliceChange(Number(event.currentTarget.value))}
          className="w-full accent-sky-400"
        />
      </div>
    </section>
  );
}
