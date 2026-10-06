import { resliceAnatomyPlane, type ParsedAnatomyNrrd, type AnatomyPlane, type ReslicedAnatomyPlane } from "./anatomy-nrrd";

type Init = { type: "init"; primary: ParsedAnatomyNrrd; segmentation: ParsedAnatomyNrrd | null };
type Slice = { type: "slice"; requestId: number; plane: AnatomyPlane; sliceIndex: number };

let primary: ParsedAnatomyNrrd | null = null;
let segmentation: ParsedAnatomyNrrd | null = null;
const sliceCache = new Map<string, ReslicedAnatomyPlane>();

function copyForTransfer(result: ReslicedAnatomyPlane): ReslicedAnatomyPlane {
  return { ...result, values: result.values.slice(), validMask: result.validMask.slice(), labels: result.labels?.slice() ?? null };
}

self.onmessage = (event: MessageEvent<Init | Slice>) => {
  if (event.data.type === "init") { primary = event.data.primary; segmentation = event.data.segmentation; return; }
  if (!primary) return;
  const key = `${event.data.plane}:${event.data.sliceIndex}`;
  let result = sliceCache.get(key);
  if (result) {
    sliceCache.delete(key);
    sliceCache.set(key, result);
  } else {
    result = resliceAnatomyPlane(primary, segmentation, event.data.plane, event.data.sliceIndex);
    sliceCache.set(key, result);
    if (sliceCache.size > 4) sliceCache.delete(sliceCache.keys().next().value!);
  }
  const transferable = copyForTransfer(result);
  const post = globalThis.postMessage as unknown as (message: unknown, transfer: Transferable[]) => void;
  post({ type: "slice", requestId: event.data.requestId, result: transferable }, [transferable.values.buffer, transferable.validMask.buffer, ...(transferable.labels ? [transferable.labels.buffer] : [])] as unknown as Transferable[]);
};
