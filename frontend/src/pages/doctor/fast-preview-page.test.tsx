import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { FastPreviewPage } from "./fast-preview-page";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("keeps the displayed image and slice number while the next image loads, and sends window parameters", async () => {
  let finishNext!: (response: Response) => void;
  let id = 0;
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => `blob:preview-${++id}`) });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  Object.defineProperty(Image.prototype, "decode", { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
  const jpeg = () => new Response(new Blob(["jpeg"], { type: "image/jpeg" }), { headers: { "X-Fast-Preview-Quality": "75", "X-Fast-Preview-Width": "512" } });
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input); requests.push(path);
    if (path.endsWith("/fast-preview")) return Response.json({ study: { patientName: "Synthetic", accessionNumber: "ACC", description: "CT", date: "20261027" }, series: [{ id: "ct", description: "CT", number: "1", modality: "CT", count: 2 }], settings: { quality: 75, maximumWidth: 512 } });
    if (path.endsWith("/series/ct")) return Response.json({ instances: [{ id: "first", number: 1 }, { id: "second", number: 2 }] });
    if (path.includes("/images/second")) return new Promise<Response>((resolve) => { finishNext = resolve; });
    return jpeg();
  }));
  render(<MemoryRouter initialEntries={["/reporting/fast-preview/42"]}><Routes><Route path="/reporting/fast-preview/:appointmentId" element={<FastPreviewPage />} /></Routes></MemoryRouter>);
  const image = await screen.findByRole("img", { name: "Non-diagnostic study preview" });
  const previous = image.getAttribute("src");
  expect(screen.getByText("1 / 2")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(image.getAttribute("src")).toBe(previous);
  expect(screen.getByText("1 / 2")).toBeTruthy();
  await waitFor(() => expect(requests.filter((path) => path.includes("/images/second")).length).toBeGreaterThanOrEqual(2));
  finishNext(jpeg());
  await screen.findByText("2 / 2");
  fireEvent.click(screen.getByRole("button", { name: "Brain" }));
  await waitFor(() => expect(requests.some((path) => path.includes("center=40") && path.includes("width=80"))).toBe(true));
});
