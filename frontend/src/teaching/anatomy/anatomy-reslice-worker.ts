import { resliceAnatomyPlane, type ParsedAnatomyNrrd, type AnatomyPlane } from "./anatomy-nrrd";

type Init = { type: "init"; primary: ParsedAnatomyNrrd; segmentation: ParsedAnatomyNrrd | null };
type Slice = { type: "slice"; requestId: number; plane: AnatomyPlane; sliceIndex: number };

let primary: ParsedAnatomyNrrd | null = null;
let segmentation: ParsedAnatomyNrrd | null = null;

self.onmessage = (event: MessageEvent<Init | Slice>) => {
  if (event.data.type === "init") { primary = event.data.primary; segmentation = event.data.segmentation; return; }
  if (!primary) return;
  const result = resliceAnatomyPlane(primary, segmentation, event.data.plane, event.data.sliceIndex);
  const post = globalThis.postMessage as unknown as (message: unknown, transfer: Transferable[]) => void;
  post({ type: "slice", requestId: event.data.requestId, result }, [result.values.buffer, result.validMask.buffer, ...(result.labels ? [result.labels.buffer] : [])] as unknown as Transferable[]);
};
