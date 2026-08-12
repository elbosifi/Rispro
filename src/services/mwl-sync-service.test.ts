import test from "node:test";
import assert from "node:assert/strict";
import { shouldSkipOrthancInitialUpsertForQueueGate } from "./mwl-sync-service.js";

test("shouldSkipOrthancInitialUpsertForQueueGate skips first scheduled upsert when queue-only mode is enabled", () => {
  assert.equal(
    shouldSkipOrthancInitialUpsertForQueueGate({
      sendOnlyWhenPatientEntersQueue: true,
      currentProjectionExists: false,
      status: "scheduled",
    }),
    true
  );
});

test("shouldSkipOrthancInitialUpsertForQueueGate allows queued statuses and existing syncs", () => {
  assert.equal(
    shouldSkipOrthancInitialUpsertForQueueGate({
      sendOnlyWhenPatientEntersQueue: true,
      currentProjectionExists: false,
      status: "arrived",
    }),
    false
  );
  assert.equal(
    shouldSkipOrthancInitialUpsertForQueueGate({
      sendOnlyWhenPatientEntersQueue: true,
      currentProjectionExists: true,
      status: "scheduled",
    }),
    false
  );
});
