import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProtocolDocumentAnnotation } from "@/types/api";
import { DocumentAnnotationOverlay } from "./document-annotation-overlay";

const annotation: ProtocolDocumentAnnotation = {
  id: 7,
  documentId: 3,
  pageNumber: 2,
  annotationType: "rectangle",
  geometry: { x: 0.1, y: 0.2, width: 0.4, height: 0.3 },
  textContent: null,
  style: null,
  createdByUserId: 11,
  createdAt: "2026-07-31T00:00:00.000Z",
  updatedAt: "2026-07-31T00:00:00.000Z",
};

describe("DocumentAnnotationOverlay", () => {
  it("renders only the selected PDF page annotations and supports selection", () => {
    const onSelect = vi.fn();
    const { container } = render(<DocumentAnnotationOverlay pageNumber={2} tool="select" annotations={[annotation]} selectedAnnotationId={null} onSelect={onSelect} onCreate={vi.fn()} />);
    expect(screen.getByLabelText("Annotations for page 2")).toBeTruthy();
    fireEvent.pointerDown(container.querySelector("rect")!);
    expect(onSelect).toHaveBeenCalledWith(7);
  });

  it("creates normalized rectangles from pointer coordinates", () => {
    const onCreate = vi.fn();
    render(<DocumentAnnotationOverlay pageNumber={1} tool="rectangle" annotations={[]} selectedAnnotationId={null} onSelect={vi.fn()} onCreate={onCreate} />);
    const svg = screen.getByLabelText("Annotations for page 1");
    Object.defineProperty(svg, "getBoundingClientRect", { value: () => ({ left: 0, top: 0, width: 100, height: 100 }) });
    fireEvent.pointerDown(svg, { clientX: 10, clientY: 20, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 60, clientY: 80, pointerId: 1 });
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ pageNumber: 1, annotationType: "rectangle", geometry: { x: 0.1, y: 0.2, width: 0.5, height: 0.6 } }));
  });

  it("renders visible drafts and preserves arrow direction", () => {
    const onCreate = vi.fn();
    const { container } = render(<DocumentAnnotationOverlay pageNumber={1} tool="arrow" annotations={[]} selectedAnnotationId={null} onSelect={vi.fn()} onCreate={onCreate} />);
    const svg = screen.getByLabelText("Annotations for page 1");
    Object.defineProperty(svg, "getBoundingClientRect", { value: () => ({ left: 0, top: 0, width: 100, height: 100 }) });
    fireEvent.pointerDown(svg, { clientX: 80, clientY: 70, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 20, clientY: 30, pointerId: 1 });
    const draft = container.querySelector("line");
    expect(draft?.getAttribute("stroke-width")).toBe("2.25");
    expect(draft?.getAttribute("vector-effect")).toBe("non-scaling-stroke");
    fireEvent.pointerUp(svg, { clientX: 20, clientY: 30, pointerId: 1 });
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ annotationType: "arrow", geometry: { x1: 0.8, y1: 0.7, x2: 0.2, y2: 0.3 } }));
  });

  it("creates sampled freehand strokes and clears insignificant drafts", () => {
    const onCreate = vi.fn();
    const { container, rerender } = render(<DocumentAnnotationOverlay pageNumber={1} tool="freehand" annotations={[]} selectedAnnotationId={null} onSelect={vi.fn()} onCreate={onCreate} />);
    const svg = screen.getByLabelText("Annotations for page 1");
    Object.defineProperty(svg, "getBoundingClientRect", { value: () => ({ left: 0, top: 0, width: 100, height: 100 }) });
    fireEvent.pointerDown(svg, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 30, clientY: 30, pointerId: 1 });
    expect(container.querySelector("polyline")).toBeTruthy();
    fireEvent.pointerUp(svg, { clientX: 50, clientY: 50, pointerId: 1 });
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ annotationType: "freehand", geometry: expect.objectContaining({ points: expect.any(Array) }) }));

    onCreate.mockClear();
    rerender(<DocumentAnnotationOverlay pageNumber={1} tool="rectangle" annotations={[]} selectedAnnotationId={null} onSelect={vi.fn()} onCreate={onCreate} />);
    const rectangleSvg = screen.getByLabelText("Annotations for page 1");
    fireEvent.pointerDown(rectangleSvg, { clientX: 20, clientY: 20, pointerId: 2 });
    fireEvent.pointerCancel(rectangleSvg, { pointerId: 2 });
    fireEvent.pointerUp(rectangleSvg, { clientX: 80, clientY: 80, pointerId: 2 });
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("renders legacy arrow geometry with a visible stroke and clears selection on blank space", () => {
    const legacyArrow: ProtocolDocumentAnnotation = { ...annotation, annotationType: "arrow", geometry: { x: 0.2, y: 0.3, width: 0.4, height: 0.1 } };
    const onSelect = vi.fn();
    const { container } = render(<DocumentAnnotationOverlay pageNumber={2} tool="select" annotations={[legacyArrow]} selectedAnnotationId={7} onSelect={onSelect} onCreate={vi.fn()} />);
    const line = container.querySelector("line");
    expect(line?.getAttribute("x1")).toBe("0.2");
    expect(line?.getAttribute("x2")).toBe("0.6000000000000001");
    expect(line?.getAttribute("stroke-width")).toBe("3");
    fireEvent.pointerDown(screen.getByLabelText("Annotations for page 2"), { clientX: 1, clientY: 1, pointerId: 3 });
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("does not create an annotation for an insignificant drag", () => {
    const onCreate = vi.fn();
    render(<DocumentAnnotationOverlay pageNumber={1} tool="rectangle" annotations={[]} selectedAnnotationId={null} onSelect={vi.fn()} onCreate={onCreate} />);
    const svg = screen.getByLabelText("Annotations for page 1");
    Object.defineProperty(svg, "getBoundingClientRect", { value: () => ({ left: 0, top: 0, width: 100, height: 100 }) });
    fireEvent.pointerDown(svg, { clientX: 20, clientY: 20, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 20.2, clientY: 20.2, pointerId: 1 });
    expect(onCreate).not.toHaveBeenCalled();
  });
});
