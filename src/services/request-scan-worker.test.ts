import assert from "node:assert/strict";
import test from "node:test";
import { runRequestScanWorkerTick } from "./request-scan-worker.js";

test("Request Scan worker tick returns the completed cycle result", async () => {
  const expected = { discovered: 3, processed: 1, failed: 1, duplicates: 0, skipped: 1 };
  assert.deepEqual(await runRequestScanWorkerTick(async () => expected), expected);
});
