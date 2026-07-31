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
});
