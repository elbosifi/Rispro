import { useRef, useState, type PointerEvent } from "react";
import type { ProtocolDocumentAnnotation, ProtocolDocumentAnnotationType } from "@/types/api";

export type AnnotationTool = ProtocolDocumentAnnotationType | "select";

type Point = { x: number; y: number };

function pointFromEvent(event: PointerEvent<SVGSVGElement>): Point {
  const rect = event.currentTarget.getBoundingClientRect();
  const normalise = (value: number) => Number(value.toFixed(6));
  return {
    x: normalise(Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)))),
    y: normalise(Math.min(1, Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height)))),
  };
}

export function DocumentAnnotationOverlay({
  pageNumber,
  rotation = 0,
  tool,
  annotations,
  selectedAnnotationId,
  onSelect,
  onCreate,
}: {
  pageNumber: number;
  rotation?: number;
  tool: AnnotationTool;
  annotations: ProtocolDocumentAnnotation[];
  selectedAnnotationId: number | null;
  onSelect: (id: number) => void;
  onCreate: (input: { pageNumber: number; annotationType: ProtocolDocumentAnnotationType; geometry: Record<string, unknown>; textContent?: string | null }) => void;
}) {
  const [draft, setDraft] = useState<Point[]>([]);
  const drawing = useRef(false);
  const pageAnnotations = annotations.filter((annotation) => annotation.pageNumber === pageNumber);
  const finishDrawing = (event: PointerEvent<SVGSVGElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    const end = pointFromEvent(event);
    const start = draft[0];
    if (!start) return;
    if (tool === "freehand") {
      const points = [...draft, end];
      if (points.length > 1) onCreate({ pageNumber, annotationType: "freehand", geometry: { points } });
    } else if (tool === "arrow" || tool === "rectangle") {
      const x = Math.min(start.x, end.x);
      const y = Math.min(start.y, end.y);
      const width = Number(Math.abs(end.x - start.x).toFixed(6));
      const height = Number(Math.abs(end.y - start.y).toFixed(6));
      onCreate({
        pageNumber,
        annotationType: tool,
        geometry: { x, y, width, height },
      });
    }
    setDraft([]);
  };

  return (
    <svg
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      className="absolute inset-0 z-10 h-full w-full"
      style={{ transform: `rotate(${rotation}deg)`, transformOrigin: "center" }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        if (tool === "text") {
          const point = pointFromEvent(event);
          const text = window.prompt("Annotation text");
          if (text?.trim()) onCreate({ pageNumber, annotationType: "text", geometry: point, textContent: text.trim() });
          return;
        }
        if (tool !== "select") {
          drawing.current = true;
          setDraft([pointFromEvent(event)]);
        }
      }}
      onPointerMove={(event) => {
        if (drawing.current && tool === "freehand") setDraft((current) => [...current, pointFromEvent(event)]);
      }}
      onPointerUp={finishDrawing}
      onPointerCancel={() => { drawing.current = false; setDraft([]); }}
      aria-label={`Annotations for page ${pageNumber}`}
    >
      {pageAnnotations.map((annotation) => {
        const geometry = annotation.geometry;
        const selected = selectedAnnotationId === annotation.id;
        const stroke = selected ? "#dc2626" : "#0f766e";
        const common = { stroke, strokeWidth: 0.004, vectorEffect: "non-scaling-stroke", onPointerDown: (event: PointerEvent<SVGElement>) => { event.stopPropagation(); onSelect(annotation.id); } };
        if (annotation.annotationType === "freehand") {
          const points = Array.isArray(geometry.points) ? geometry.points as Point[] : [];
          return <polyline key={annotation.id} points={points.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" {...common} />;
        }
        if (annotation.annotationType === "text") {
          return <text key={annotation.id} x={Number(geometry.x ?? 0)} y={Number(geometry.y ?? 0)} fill={stroke} fontSize="0.035" {...common}>{annotation.textContent}</text>;
        }
        if (annotation.annotationType === "arrow") {
          const x = Number(geometry.x ?? 0); const y = Number(geometry.y ?? 0); const width = Number(geometry.width ?? 0); const height = Number(geometry.height ?? 0);
          return <line key={annotation.id} x1={x} y1={y} x2={x + width} y2={y + height} markerEnd="url(#annotation-arrow)" fill="none" {...common} />;
        }
        return <rect key={annotation.id} x={Number(geometry.x ?? 0)} y={Number(geometry.y ?? 0)} width={Number(geometry.width ?? 0)} height={Number(geometry.height ?? 0)} fill="none" {...common} />;
      })}
      {draft.length > 1 && tool === "freehand" ? <polyline points={draft.map((point) => `${point.x},${point.y}`).join(" ")} stroke="#0f766e" strokeWidth="0.004" fill="none" /> : null}
      <defs><marker id="annotation-arrow" markerWidth="0.06" markerHeight="0.06" refX="0.05" refY="0.03" orient="auto"><path d="M0,0 L0.06,0.03 L0,0.06 z" fill="#0f766e" /></marker></defs>
    </svg>
  );
}
