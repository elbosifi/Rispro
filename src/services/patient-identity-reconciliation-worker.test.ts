import test from "node:test";
import assert from "node:assert/strict";
import {
  __patientIdentityReconciliationWorkerTestables,
  runPatientIdentityReconciliationWorkerTick,
  startPatientIdentityReconciliationWorker,
} from "./patient-identity-reconciliation-worker.js";

test.afterEach(() => __patientIdentityReconciliationWorkerTestables.resetDependencies());

test("worker claims and processes one durable job", async () => {
  const processed: number[] = [];
  __patientIdentityReconciliationWorkerTestables.setDependencies({
    claim: async () => ({ id: 17 } as never),
    process: async ({ job }) => { processed.push(job.id); },
  });
  assert.deepEqual(await runPatientIdentityReconciliationWorkerTick({ owner: "test-worker" }), { claimed: 1, completed: 1, failed: 0 });
  assert.deepEqual(processed, [17]);
});

test("worker reports processing failure without rejecting the tick", async () => {
  __patientIdentityReconciliationWorkerTestables.setDependencies({
    claim: async () => ({ id: 18 } as never),
    process: async () => { throw new Error("simulated failure"); },
  });
  assert.deepEqual(await runPatientIdentityReconciliationWorkerTick({ owner: "test-worker" }), { claimed: 1, completed: 0, failed: 1 });
});

test("graceful stop prevents later claims", async () => {
  let claims = 0;
  __patientIdentityReconciliationWorkerTestables.setDependencies({ claim: async () => { claims += 1; return null; } });
  const worker = await startPatientIdentityReconciliationWorker({ intervalMs: 10_000 });
  const startupClaims = claims;
  await worker.stop();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(claims, startupClaims);
});
