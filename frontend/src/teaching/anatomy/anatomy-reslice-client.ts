import type { TeachingAnatomyPlane } from "../api/teaching-api";
import type { ParsedAnatomyNrrd, ReslicedAnatomyPlane } from "./anatomy-nrrd";

interface SliceMessage { type: "slice"; requestId: number; result: ReslicedAnatomyPlane }
interface ClientEntry {
  worker: Worker;
  users: number;
  nextRequestId: number;
  activeRequestId: number | null;
  queued: Map<TeachingAnatomyPlane, { type: "slice"; requestId: number; plane: TeachingAnatomyPlane; sliceIndex: number }>;
  shutdownTimer: ReturnType<typeof setTimeout> | null;
  pending: Map<number, (result: ReslicedAnatomyPlane) => void>;
}

const entries = new WeakMap<ParsedAnatomyNrrd, Map<ParsedAnatomyNrrd | null, ClientEntry>>();

export function openAnatomyResliceSession(primary: ParsedAnatomyNrrd, segmentation: ParsedAnatomyNrrd | null) {
  let volumeSessions = entries.get(primary);
  if (!volumeSessions) { volumeSessions = new Map(); entries.set(primary, volumeSessions); }
  let entry = volumeSessions.get(segmentation);
  if (!entry) {
    const worker = new Worker(new URL("./anatomy-reslice-worker.ts", import.meta.url), { type: "module" });
    entry = { worker, users: 0, nextRequestId: 0, activeRequestId: null, queued: new Map(), shutdownTimer: null, pending: new Map() };
    worker.onmessage = (event: MessageEvent<SliceMessage>) => {
      if (event.data.type !== "slice") return;
      const callback = entry!.pending.get(event.data.requestId);
      entry!.pending.delete(event.data.requestId);
      callback?.(event.data.result);
      if (entry!.activeRequestId === event.data.requestId) entry!.activeRequestId = null;
      const next = entry!.queued.values().next().value;
      if (next) {
        entry!.queued.delete(next.plane);
        entry!.activeRequestId = next.requestId;
        worker.postMessage(next);
      }
    };
    const buffers = [primary.data.buffer, ...(segmentation ? [segmentation.data.buffer] : [])];
    const transfer = buffers.filter((buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer);
    // Parsed voxel storage is only consumed by the MPR worker after geometry and
    // display-range setup; transfer ownership instead of cloning large volumes.
    worker.postMessage({ type: "init", primary, segmentation }, transfer);
    volumeSessions.set(segmentation, entry);
  }
  if (entry.shutdownTimer !== null) { clearTimeout(entry.shutdownTimer); entry.shutdownTimer = null; }
  entry.users += 1;
  let released = false;
  return {
    requestSlice(plane: TeachingAnatomyPlane, sliceIndex: number, onResult: (result: ReslicedAnatomyPlane) => void): () => void {
      if (released) return () => undefined;
      const requestId = ++entry!.nextRequestId;
      entry!.pending.set(requestId, onResult);
      const request = { type: "slice" as const, requestId, plane, sliceIndex };
      if (entry!.activeRequestId === null) {
        entry!.activeRequestId = requestId;
        entry!.worker.postMessage(request);
      } else {
        const replaced = entry!.queued.get(plane);
        if (replaced) entry!.pending.delete(replaced.requestId);
        entry!.queued.set(plane, request);
      }
      return () => {
        entry!.pending.delete(requestId);
        if (entry!.queued.get(plane)?.requestId === requestId) entry!.queued.delete(plane);
      };
    },
    release(): void {
      if (released) return;
      released = true;
      entry!.users -= 1;
      if (entry!.users === 0) {
        entry!.pending.clear();
        entry!.queued.clear();
        // A zero-delay lease lets React Strict Mode's setup/cleanup/setup cycle
        // reuse the transferred dataset instead of trying to transfer it twice.
        entry!.shutdownTimer = setTimeout(() => {
          if (entry!.users !== 0) return;
          entry!.worker.terminate();
          entry!.shutdownTimer = null;
          volumeSessions!.delete(segmentation);
          if (volumeSessions!.size === 0) entries.delete(primary);
        }, 0);
      }
    },
  };
}
