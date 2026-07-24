import type { RequestScanProgressUpdate } from "./request-scan-processing-service.js";

export type RequestScanProgressCoalescer = {
  update(value: RequestScanProgressUpdate): Promise<void>;
  flush(): Promise<void>;
  cancel(): void;
  writes(): number;
};

export function createRequestScanProgressCoalescer(
  write: (value: RequestScanProgressUpdate) => Promise<void>,
  intervalMs = 750,
): RequestScanProgressCoalescer {
  let stage: string | null = null;
  let pending: RequestScanProgressUpdate | null = null;
  let timer: NodeJS.Timeout | null = null;
  let cancelled = false;
  let writeCount = 0;
  let chain = Promise.resolve();

  const commit = (value: RequestScanProgressUpdate): Promise<void> => {
    if (cancelled) return Promise.resolve();
    writeCount += 1;
    chain = chain.then(() => cancelled ? undefined : write(value));
    return chain;
  };
  const clear = () => { if (timer) clearTimeout(timer); timer = null; };
  const flush = async () => {
    clear();
    const value = pending;
    pending = null;
    if (value) await commit(value);
    else await chain;
  };
  const schedule = () => {
    if (timer || cancelled) return;
    timer = setTimeout(() => {
      timer = null;
      const value = pending;
      pending = null;
      if (value) void commit(value).catch(() => { cancelled = true; });
    }, intervalMs);
  };

  return {
    async update(value) {
      if (cancelled) return;
      const stageChanged = value.stage !== stage;
      const final = value.total != null && value.current === value.total;
      if (stageChanged) {
        await flush();
        stage = value.stage;
        await commit(value);
        return;
      }
      if (final) {
        pending = value;
        await flush();
        return;
      }
      pending = value;
      schedule();
    },
    flush,
    cancel() { cancelled = true; pending = null; clear(); },
    writes() { return writeCount; },
  };
}
