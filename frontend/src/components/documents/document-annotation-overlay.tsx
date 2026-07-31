import { useRef, useState, type PointerEvent } from "react";
import type { ProtocolDocumentAnnotation, ProtocolDocumentAnnotationType } from "@/types/api";

export type AnnotationTool = ProtocolDocumentAnnotationType | "select";

type Point = { x: number; y: number };

const STROKE_WIDTH = 2.25;
const MIN_DRAG_DISTANCE = 0.008;

function pointFromEvent(event: PointerEvent<SVGSVGElement>): Point {
  const rect = event.currentTarget.getBoundingClientRect();
  const normalise = (value: number) => Number(value.toFixed(6));
  return {
    x: normalise(Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)))),
    y: normalise(Math.min(1, Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height)))),
  };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function rectangleGeometry(start: Point, end: Point) {
  return {
    x: Number(Math.min(start.x, end.x).toFixed(6)),
    y: Number(Math.min(start.y, end.y).toFixed(6)),
    width: Number(Math.abs(end.x - start.x).toFixed(6)),
    height: Number(Math.abs(end.y - start.y).toFixed(6)),
  };
}

function arrowGeometry(start: Point, end: Point) {
  return {
    x1: start.x,
    y1: start.y,
    x2: end.x,
    y2: end.y,
  };
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value ?? fallback);
}

function arrowPoints(geometry: Record<string, unknown>) {
  const x = numberValue(geometry.x);
  const y = numberValue(geometry.y);
  const width = numberValue(geometry.width);
  const height = numberValue(geometry.height);
  return {
    x1: numberValue(geometry.x1, x),
    y1: numberValue(geometry.y1, y),
    x2: numberValue(geometry.x2, x + width),
    y2: numberValue(geometry.y2, y + height),
  };
}

export function DocumentAnnotationOverlay({
  pageNumber,
  rotation: _rotation = 0,
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
  onSelect: (id: number | null) => void;
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
    setDraft([]);
    if (!start || distance(start, end) < MIN_DRAG_DISTANCE) return;

    if (tool === "freehand") {
      const points = [...draft, end];
      if (points.length > 1) onCreate({ pageNumber, annotationType: "freehand", geometry: { points } });
    } else if (tool === "arrow") {
      onCreate({ pageNumber, annotationType: "arrow", geometry: arrowGeometry(start, end) });
    } else if (tool === "rectangle") {
      onCreate({ pageNumber, annotationType: "rectangle", geometry: rectangleGeometry(start, end) });
    }
  };
  const arrowMarkerId = `annotation-arrow-${pageNumber}`;
  const renderCommon = (annotationId?: number) => ({
    stroke: selectedAnnotationId === annotationId ? "#dc2626" : "#0f766e",
    strokeWidth: selectedAnnotationId === annotationId ? 3 : STROKE_WIDTH,
    vectorEffect: "non-scaling-stroke" as const,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    onPointerDown: (event: PointerEvent<SVGElement>) => {
      event.stopPropagation();
      if (tool === "select" && annotationId !== undefined) onSelect(annotationId);
    },
  });

  return (
    <svg
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      className="absolute inset-0 z-10 h-full w-full"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        if (tool === "text") {
          const point = pointFromEvent(event);
          const text = window.prompt("Annotation text");
          if (text?.trim()) onCreate({ pageNumber, annotationType: "text", geometry: point, textContent: text.trim() });
          return;
        }
        if (tool === "select") {
          onSelect(null);
          return;
        }
        drawing.current = true;
        setDraft([pointFromEvent(event)]);
      }}
      onPointerMove={(event) => {
        if (!drawing.current) return;
        const point = pointFromEvent(event);
        setDraft((current) => {
          const last = current.at(-1);
          if (last && tool === "freehand" && distance(last, point) < 0.004) return current;
          return tool === "freehand" ? [...current, point] : current[0] ? [current[0], point] : current;
        });
      }}
      onPointerUp={finishDrawing}
      onPointerCancel={() => { drawing.current = false; setDraft([]); }}
      aria-label={`Annotations for page ${pageNumber}`}
    >
      {pageAnnotations.map((annotation) => {
        const geometry = annotation.geometry;
        const common = renderCommon(annotation.id);
        if (annotation.annotationType === "freehand") {
          const points = Array.isArray(geometry.points) ? geometry.points as Point[] : [];
          return <polyline key={annotation.id} points={points.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" {...common} />;
        }
        if (annotation.annotationType === "text") {
          return <text key={annotation.id} x={numberValue(geometry.x)} y={numberValue(geometry.y)} fontSize="0.035" {...common} fill={common.stroke} stroke="none">{annotation.textContent}</text>;
        }
        if (annotation.annotationType === "arrow") {
          const points = arrowPoints(geometry);
          return <line key={annotation.id} x1={points.x1} y1={points.y1} x2={points.x2} y2={points.y2} markerEnd={`url(#${arrowMarkerId})`} fill="none" {...common} />;
        }
        const rect = rectangleGeometry({ x: numberValue(geometry.x), y: numberValue(geometry.y) }, { x: numberValue(geometry.x) + numberValue(geometry.width), y: numberValue(geometry.y) + numberValue(geometry.height) });
        return <rect key={annotation.id} x={rect.x} y={rect.y} width={rect.width} height={rect.height} fill="none" {...common} />;
      })}
      {draft.length > 1 && tool === "freehand" ? <polyline points={draft.map((point) => `${point.x},${point.y}`).join(" ")} stroke="#0f766e" strokeWidth={STROKE_WIDTH} vectorEffect="non-scaling-stroke" strokeLinecap="round" fill="none" /> : null}
      {draft.length > 1 && tool === "arrow" ? <line x1={draft[0]!.x} y1={draft[0]!.y} x2={draft.at(-1)!.x} y2={draft.at(-1)!.y} markerEnd={`url(#${arrowMarkerId})`} stroke="#0f766e" strokeWidth={STROKE_WIDTH} vectorEffect="non-scaling-stroke" strokeLinecap="round" fill="none" /> : null}
      {draft.length > 1 && tool === "rectangle" ? (() => { const rect = rectangleGeometry(draft[0]!, draft.at(-1)!); return <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} stroke="#0f766e" strokeWidth={STROKE_WIDTH} vectorEffect="non-scaling-stroke" fill="none" />; })() : null}
      <defs><marker id={arrowMarkerId} markerWidth="4" markerHeight="4" refX="3.5" refY="2" markerUnits="strokeWidth" orient="auto"><path d="M0,0 L4,2 L0,4 z" fill="#0f766e" /></marker></defs>
    </svg>
  );
}
