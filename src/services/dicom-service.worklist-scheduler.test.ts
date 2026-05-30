import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const source = readFileSync(new URL("./dicom-service.ts", import.meta.url), "utf8");

describe("DICOM worklist scheduler source guards", () => {
  it("serializes scheduled booking worklist syncs instead of fanning out immediately", () => {
    assert.match(source, /scheduledBookingWorklistSyncQueue/);
    assert.match(source, /isDrainingScheduledBookingWorklistSyncs/);
    assert.doesNotMatch(source, /Promise\.resolve\(\)\s*\n\s*\.then\(\(\) => syncBookingWorklistSources/);
  });
});
