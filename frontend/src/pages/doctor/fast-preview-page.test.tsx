import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FastPreviewPage } from "./fast-preview-page";

const jpeg = () => new Response(new Blob(["jpeg"], { type: "image/jpeg" }));
const requests: string[] = [];

beforeEach(() => {
  requests.length = 0;
  let id = 0;
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => `blob:preview-${++id}`) });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  Object.defineProperty(Image.prototype, "decode", { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(imageResponse: (path: string, options?: RequestInit) => Response | Promise<Response> = jpeg) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const path = String(input);
    requests.push(path);
    if (path.endsWith("/fast-preview")) return Response.json({
      study: { patientName: "Synthetic", accessionNumber: "ACC", description: "CT", date: "20261029" },
      series: [{ id: "ct", description: "CT", number: "1", modality: "CT", count: 8 }, { id: "mr", description: "MR", number: "2", modality: "MR", count: 3 }],
      settings: { quality: 75, maximumWidth: 512 },
    });
    if (path.endsWith("/series/ct")) return Response.json({ instances: Array.from({ length: 8 }, (_, i) => ({ id: `ct-${i}`, number: i + 1 })) });
    if (path.endsWith("/series/mr")) return Response.json({ instances: Array.from({ length: 3 }, (_, i) => ({ id: `mr-${i}`, number: i + 1 })) });
    return imageResponse(path, options);
  }));
  return render(<MemoryRouter initialEntries={["/reporting/fast-preview/42"]}><Routes><Route path="/reporting/fast-preview/:appointmentId" element={<FastPreviewPage />} /></Routes></MemoryRouter>);
}

it("loads every image once on selection and browses the whole cached series without more requests", async () => {
  setup();
  await screen.findByText("1 / 8 · Series loaded");
  expect(requests.filter((path) => path.includes("/images/"))).toHaveLength(8);
  const viewer = screen.getByRole("region", { name: "Image viewer" });
  fireEvent.keyDown(viewer, { key: "End" });
  await screen.findByText("8 / 8 · Series loaded");
  fireEvent.keyDown(viewer, { key: "Home" });
  await screen.findByText("1 / 8 · Series loaded");
  expect(requests.filter((path) => path.includes("/images/"))).toHaveLength(8);
  fireEvent.change(screen.getByLabelText("Series"), { target: { value: "mr" } });
  await screen.findByText("1 / 3 · Series loaded");
  expect(requests.filter((path) => path.includes("/images/mr-"))).toHaveLength(3);
  expect(screen.queryByRole("option", { name: "Brain" })).toBeNull();
});

it("keeps the actual displayed slice while the requested image finishes loading without duplicating the request", async () => {
  let finishNext!: (response: Response) => void;
  setup((path) => path.includes("/images/ct-1") ? new Promise<Response>((resolve) => { finishNext = resolve; }) : jpeg());
  const image = await screen.findByRole("img");
  const previous = image.getAttribute("src");
  fireEvent.wheel(screen.getByRole("region", { name: "Image viewer" }), { deltaY: 100 });
  expect(image.getAttribute("src")).toBe(previous);
  expect(screen.getByRole("status").textContent).toContain("1 / 8");
  await waitFor(() => expect(requests.filter((path) => path.includes("/images/ct-1"))).toHaveLength(1));
  finishNext(jpeg());
  await screen.findByText("2 / 8 · Series loaded");
  expect(image.getAttribute("src")).not.toBe(previous);
});

it("applies the selected window to the entire series, resets to DICOM on series selection, and releases old URLs", async () => {
  setup();
  await screen.findByText("1 / 8 · Series loaded");
  fireEvent.change(screen.getByLabelText("Window"), { target: { value: "Brain" } });
  await waitFor(() => expect(requests.filter((path) => path.includes("center=40&width=80"))).toHaveLength(8));
  await screen.findByText("1 / 8 · Series loaded");
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(8);
  fireEvent.change(screen.getByLabelText("Window"), { target: { value: "dicom" } });
  await waitFor(() => expect(requests.filter((path) => path.includes("/images/") && !path.includes("?"))).toHaveLength(16));
  fireEvent.change(screen.getByLabelText("Series"), { target: { value: "mr" } });
  await screen.findByText("1 / 3 · Series loaded");
  expect((screen.getByLabelText("Window") as HTMLSelectElement).value).toBe("dicom");
});

it("cancels a superseded batch and ignores images that finish after the next series is selected", async () => {
  let finishOld!: (response: Response) => void;
  let oldSignal: AbortSignal | null | undefined;
  setup((path, options) => {
    if (path.includes("/images/ct-0")) {
      oldSignal = options?.signal;
      return new Promise<Response>((resolve) => { finishOld = resolve; });
    }
    return jpeg();
  });
  await waitFor(() => expect(finishOld).toBeTypeOf("function"));
  fireEvent.change(screen.getByLabelText("Series"), { target: { value: "mr" } });
  await screen.findByText("1 / 3 · Series loaded");
  const current = screen.getByRole("img").getAttribute("src");
  expect(oldSignal?.aborted).toBe(true);
  finishOld(jpeg());
  await waitFor(() => expect(screen.getByRole("img").getAttribute("src")).toBe(current));
  expect(screen.getByRole("status").textContent).toBe("1 / 3 · Series loaded");
});

it("contains wheel scrolling at both series boundaries and restores document scrolling on exit", async () => {
  const previousBody = document.body.style.overflow;
  const previousHtml = document.documentElement.style.overflow;
  const { unmount } = setup();
  await screen.findByText("1 / 8 · Series loaded");
  const viewer = screen.getByRole("region", { name: "Image viewer" });
  const wheel = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
  fireEvent(viewer, wheel);
  expect(wheel.defaultPrevented).toBe(true);
  expect(screen.getByRole("status").textContent).toContain("1 / 8");
  fireEvent.keyDown(viewer, { key: "End" });
  await screen.findByText("8 / 8 · Series loaded");
  fireEvent.wheel(viewer, { deltaY: 100 });
  expect(screen.getByRole("status").textContent).toContain("8 / 8");
  expect(document.body.style.overflow).toBe("hidden");
  expect(document.documentElement.style.overflow).toBe("hidden");
  unmount();
  expect(document.body.style.overflow).toBe(previousBody);
  expect(document.documentElement.style.overflow).toBe(previousHtml);
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(8);
});

it("reports an unavailable slice without mislabelling the previous image or stopping the rest of the series", async () => {
  setup((path) => path.includes("/images/ct-1") ? new Response(null, { status: 415 }) : jpeg());
  await screen.findByText("1 / 8 · 1 image unavailable");
  fireEvent.keyDown(screen.getByRole("region", { name: "Image viewer" }), { key: "ArrowDown" });
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("Showing the previous image. This image is unsupported."));
  expect(screen.getByRole("status").textContent).toContain("1 / 8");
  fireEvent.keyDown(screen.getByRole("region", { name: "Image viewer" }), { key: "ArrowDown" });
  await screen.findByText("3 / 8 · 1 image unavailable");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(requests.filter((path) => path.includes("/images/"))).toHaveLength(8);
});
