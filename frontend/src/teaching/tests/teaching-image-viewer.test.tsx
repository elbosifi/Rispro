import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TeachingLearnerQuestion } from "../api/teaching-api";
import { TeachingImageViewer } from "../components/teaching-image-viewer";

type TeachingImage = TeachingLearnerQuestion["images"][number];

function image(id: number, altText = `Synthetic axial image ${id}`, mimeType = "image/png"): TeachingImage {
  return { id, mimeType, altText, url: `/api/teaching/assets/${id}` };
}

afterEach(cleanup);

describe("TeachingImageViewer", () => {
  it("renders nothing for a text-only question", () => {
    const { container } = render(<TeachingImageViewer images={[]} resetKey={501} />);

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("shows one protected Teaching image with its alt text and an enlarge action", () => {
    render(<TeachingImageViewer images={[image(1, "Synthetic MRI")]} resetKey={501} />);

    expect(screen.getByRole("img", { name: "Synthetic MRI" }).getAttribute("src")).toBe("/api/teaching/assets/1");
    expect(screen.getByText("Image 1 of 1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Enlarge Synthetic MRI" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Loading image");
    fireEvent.load(screen.getByRole("img", { name: "Synthetic MRI" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("button", { name: "Show image 1" })).toBeNull();
  });

  it("navigates multiple images with previous, next, and thumbnails", () => {
    render(<TeachingImageViewer images={[image(1), image(2), image(3)]} resetKey={501} />);

    expect(screen.getByText("Image 1 of 3")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Previous image" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next image" }));
    expect(screen.getByText("Image 2 of 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show image 3" }));
    expect(screen.getByText("Image 3 of 3")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show image 3" }).getAttribute("aria-pressed")).toBe("true");
    expect((screen.getByRole("button", { name: "Next image" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Previous image" }));
    expect(screen.getByText("Image 2 of 3")).toBeTruthy();
  });

  it("opens a focused viewer, zooms, fits, pans, navigates, and closes with Escape", () => {
    render(<TeachingImageViewer images={[image(1), image(2)]} resetKey={501} />);
    fireEvent.click(screen.getByRole("button", { name: "Enlarge Synthetic axial image 1" }));
    const dialog = screen.getByRole("dialog", { name: "Teaching image viewer" });
    const modal = within(dialog);
    const stage = modal.getByTestId("teaching-image-stage");
    const activeImage = modal.getByRole("img", { name: "Synthetic axial image 1" });

    expect(modal.getByText("Image 1 / 2 · Synthetic axial image 1")).toBeTruthy();
    expect((activeImage as HTMLImageElement).style.transform).toContain("scale(1)");
    fireEvent.click(modal.getByRole("button", { name: "Zoom in" }));
    expect((activeImage as HTMLImageElement).style.transform).toContain("scale(1.25)");
    fireEvent.click(modal.getByRole("button", { name: "Zoom out" }));
    expect((activeImage as HTMLImageElement).style.transform).toContain("scale(1)");
    fireEvent.click(modal.getByRole("button", { name: "Zoom in" }));
    fireEvent.pointerDown(stage, { pointerId: 7, pointerType: "touch", button: 0, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(stage, { pointerId: 7, pointerType: "touch", clientX: 35, clientY: 50 });
    expect((activeImage as HTMLImageElement).style.transform).toContain("translate(25px, 30px)");
    fireEvent.click(modal.getByRole("button", { name: "Fit image" }));
    expect((activeImage as HTMLImageElement).style.transform).toContain("translate(0px, 0px) scale(1)");
    fireEvent.click(modal.getByRole("button", { name: "Next" }));
    expect(modal.getByText("Image 2 / 2 · Synthetic axial image 2")).toBeTruthy();
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(modal.getByText("Image 1 / 2 · Synthetic axial image 1")).toBeTruthy();
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(modal.getByText("Image 2 / 2 · Synthetic axial image 2")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Teaching image viewer" })).toBeNull();
  });

  it("resets selected image, zoom, pan, and modal state when the question changes", () => {
    const images = [image(1), image(2)];
    const view = render(<TeachingImageViewer images={images} resetKey={501} />);
    fireEvent.click(screen.getByRole("button", { name: "Show image 2" }));
    expect(screen.getByText("Image 2 of 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Enlarge Synthetic axial image 2" }));
    const dialog = within(screen.getByRole("dialog", { name: "Teaching image viewer" }));
    fireEvent.click(dialog.getByRole("button", { name: "Zoom in" }));
    const stage = dialog.getByTestId("teaching-image-stage");
    fireEvent.pointerDown(stage, { pointerId: 9, pointerType: "touch", button: 0, clientX: 4, clientY: 8 });
    fireEvent.pointerMove(stage, { pointerId: 9, pointerType: "touch", clientX: 24, clientY: 28 });
    expect((dialog.getByRole("img", { name: "Synthetic axial image 2" }) as HTMLImageElement).style.transform).toContain("translate(20px, 20px)");

    view.rerender(<TeachingImageViewer images={images} resetKey={502} />);

    expect(screen.queryByRole("dialog", { name: "Teaching image viewer" })).toBeNull();
    expect(screen.getByText("Image 1 of 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Enlarge Synthetic axial image 1" }));
    const resetImage = within(screen.getByRole("dialog", { name: "Teaching image viewer" })).getByRole("img", { name: "Synthetic axial image 1" });
    expect((resetImage as HTMLImageElement).style.transform).toBe("translate(0px, 0px) scale(1)");
  });

  it("uses an indexed meaningful alt fallback and reports broken or unsupported assets", () => {
    render(<TeachingImageViewer images={[image(1, ""), image(2, "", "image/gif")]} resetKey={501} />);
    expect(screen.getByRole("img", { name: "Teaching image 1 of 2" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show image 2" }));
    expect(screen.getByText("This Teaching image could not be displayed.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Enlarge Teaching image 2 of 2" }));
    expect(screen.getByRole("alert").textContent).toContain("question");
  });

  it("shows a recoverable placeholder when an image request fails", () => {
    render(<TeachingImageViewer images={[image(1)]} resetKey={501} />);
    fireEvent.error(screen.getByRole("img", { name: "Synthetic axial image 1" }));

    expect(screen.getByText("This Teaching image could not be displayed.")).toBeTruthy();
    expect(screen.getByText("Image 1 of 1")).toBeTruthy();
  });
});
