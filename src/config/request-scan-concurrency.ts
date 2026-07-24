export function readRequestScanMaxConcurrency(value: string | undefined): 1 | 2 {
  if (value == null || value === "") return 1;
  if (!/^[12]$/.test(value)) throw new Error("REQUEST_SCAN_MAX_CONCURRENCY must be either 1 or 2.");
  return Number(value) as 1 | 2;
}
