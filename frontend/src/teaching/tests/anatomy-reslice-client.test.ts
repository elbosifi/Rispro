import { afterEach, describe, expect, it, vi } from "vitest";
import { openAnatomyResliceSession } from "../anatomy/anatomy-reslice-client";
import type { ParsedAnatomyNrrd, ReslicedAnatomyPlane } from "../anatomy/anatomy-nrrd";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  posted: unknown[] = [];
  transfers: Transferable[][] = [];
  terminated = false;
  constructor() { FakeWorker.instances.push(this); }
  postMessage(message: unknown, transfer: Transferable[] = []) { this.posted.push(message); this.transfers.push(transfer); }
  terminate() { this.terminated = true; }
  reply(requestId: number, result: ReslicedAnatomyPlane) { this.onmessage?.({ data: { type: "slice", requestId, result } } as MessageEvent); }
}

const volume: ParsedAnatomyNrrd = { geometry: { sizes: [1, 1, 1], coordinateSystem: "LPS", origin: [0, 0, 0], directions: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] }, data: new Int16Array([0]), type: "short", slope: 1, intercept: 0 };
const result: ReslicedAnatomyPlane = { width: 1, height: 1, spacingX: 1, spacingY: 1, values: new Float32Array([0]), validMask: new Uint8Array([1]), labels: null, markers: { left: "R", right: "L" } };

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); FakeWorker.instances = []; });

describe("shared anatomy reslice worker client", () => {
  it("shares one transferable worker, coalesces rapid scrolling, and drops stale slice results", () => {
    vi.stubGlobal("Worker", FakeWorker);
    vi.useFakeTimers();
    const axial = openAnatomyResliceSession(volume, null);
    const coronal = openAnatomyResliceSession(volume, null);
    const sagittal = openAnatomyResliceSession(volume, null);
    expect(FakeWorker.instances).toHaveLength(1);
    const worker = FakeWorker.instances[0]!;
    expect(worker.posted.filter((message) => (message as { type: string }).type === "init")).toHaveLength(1);
    expect(worker.posted[0]).toEqual({ type: "init", primary: volume, segmentation: null });
    expect(worker.transfers[0]).toEqual([volume.data.buffer]);

    const stale = vi.fn();
    const cancel = axial.requestSlice("axial", 1, stale);
    const request = worker.posted.at(-1) as { requestId: number };
    cancel();
    const staleSecond = vi.fn();
    const cancelSecond = axial.requestSlice("axial", 2, staleSecond);
    cancelSecond();
    const current = vi.fn();
    axial.requestSlice("axial", 3, current);
    expect(worker.posted.filter((message) => (message as { type: string }).type === "slice")).toHaveLength(1);
    worker.reply(request.requestId, result);
    expect(stale).not.toHaveBeenCalled();
    expect(staleSecond).not.toHaveBeenCalled();

    const currentRequest = worker.posted.at(-1) as { requestId: number; sliceIndex: number };
    expect(currentRequest.sliceIndex).toBe(3);
    worker.reply(currentRequest.requestId, result);
    expect(current).toHaveBeenCalledWith(result);
    const coronalResult = vi.fn();
    coronal.requestSlice("coronal", 2, coronalResult);
    const latest = worker.posted.at(-1) as { requestId: number };
    worker.reply(latest.requestId, result);
    axial.release();
    expect(worker.terminated).toBe(false);
    coronal.release();
    sagittal.release();
    const strictModeRemount = openAnatomyResliceSession(volume, null);
    expect(FakeWorker.instances).toHaveLength(1);
    strictModeRemount.release();
    vi.runAllTimers();
    expect(worker.terminated).toBe(true);
  });
});
