import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./no-show-worker.ts", import.meta.url), "utf8");
test("no-show worker has single-flight lifecycle and configurable recurring execution", () => {
  assert.match(source, /tickRunning \|\| stopped/);
  assert.match(source, /NO_SHOW_WORKER_INTERVAL_MS/);
  assert.match(source, /setInterval/);
  assert.match(source, /while \(tickRunning\)/);
  assert.match(source, /runAutomaticNoShowProcessing/);
});
