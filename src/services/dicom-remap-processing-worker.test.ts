import test from "node:test";
import assert from "node:assert/strict";
import { __dicomRemapTestables } from "./dicom-remap-service.js";
import { __dicomRemapProcessingWorkerTestables, runDicomRemapProcessingWorkerTick, startDicomRemapProcessingWorker } from "./dicom-remap-processing-worker.js";

test.afterEach(() => {
  __dicomRemapTestables.resetTestOverrides();
  __dicomRemapProcessingWorkerTestables.resetDependencies();
});

test("processing worker uses the durable claim path and is idle when no job is queued", async () => {
  const calls: string[] = [];
  __dicomRemapTestables.setQueryForTests(async (sql: unknown) => {
    calls.push(String(sql));
    return { rows: [] } as never;
  });
  const result = await runDicomRemapProcessingWorkerTick({ owner: "test-worker", batchSize: 1, leaseSeconds: 120 });
  assert.deepEqual(result, { claimed: 0, completed: 0, failed: 0 });
  assert.ok(calls.some((sql) => /for update skip locked/i.test(sql)));
});

test.beforeEach(() => {
  __dicomRemapProcessingWorkerTestables.setDependencies({ readRetentionSettings: async () => ({ sentSourceRetentionDays: 4 }) });
});

test("non-test processing workers cannot claim from the disposable integration database", async () => {
  let claims = 0;
  __dicomRemapProcessingWorkerTestables.setDependencies({
    releaseRecoveries: async () => 0,
    cleanup: async () => 0,
    claim: async () => {
      claims += 1;
      return null;
    },
  });
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  try {
    process.env.DATABASE_URL = "postgresql://rispro_test:secret@localhost:5433/rispro_test";
    for (const nodeEnv of ["development", "production"]) {
      process.env.NODE_ENV = nodeEnv;
      await assert.rejects(
        () => runDicomRemapProcessingWorkerTick({ owner: `misconfigured-${nodeEnv}-worker`, batchSize: 1 }),
        /cannot run against the disposable rispro_test database outside NODE_ENV=test/i
      );
    }
    await assert.rejects(
      () => startDicomRemapProcessingWorker({ intervalMs: 10_000, batchSize: 1 }),
      /cannot run against the disposable rispro_test database outside NODE_ENV=test/i
    );
    assert.equal(claims, 0);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});

test("test processing workers retain the disposable-database claim path", async () => {
  let claims = 0;
  __dicomRemapProcessingWorkerTestables.setDependencies({
    releaseRecoveries: async () => 0,
    cleanup: async () => 0,
    claim: async () => {
      claims += 1;
      return null;
    },
  });
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  try {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgresql://rispro_test:secret@localhost:5433/rispro_test";
    assert.deepEqual(
      await runDicomRemapProcessingWorkerTick({ owner: "integration-test-worker", batchSize: 1 }),
      { claimed: 0, completed: 0, failed: 0 }
    );
    assert.equal(claims, 1);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});

test("processing worker runs failed, abandoned-awaiting, and sent staging retention before claiming", async () => {
  let cleanupArgs: [number, number, number | null | undefined] | null = null;
  __dicomRemapProcessingWorkerTestables.setDependencies({
    releaseRecoveries: async () => 0,
    cleanup: async (failedHours, awaitingHours, sentHours) => {
      cleanupArgs = [failedHours, awaitingHours, sentHours];
      return 0;
    },
    readRetentionSettings: async () => ({ sentSourceRetentionDays: 4 }),
    claim: async () => null,
  });
  const result = await runDicomRemapProcessingWorkerTick({ owner: "cleanup-worker", batchSize: 1, leaseSeconds: 120 });
  assert.deepEqual(result, { claimed: 0, completed: 0, failed: 0 });
  assert.deepEqual(cleanupArgs, [
    Math.max(1, Number(process.env.DICOM_REMAP_FAILED_STAGING_RETENTION_HOURS || 72)),
    Math.max(1, Number(process.env.DICOM_REMAP_AWAITING_CONFIRMATION_RETENTION_HOURS || 24)),
    96,
  ]);
});

test("processing worker reads the configured sent retention and skips only sent cleanup if that read fails", async () => {
  const cleanupCalls: Array<[number, number, number | null | undefined]> = [];
  __dicomRemapProcessingWorkerTestables.setDependencies({
    releaseRecoveries: async () => 0,
    cleanup: async (failed, awaiting, sent) => { cleanupCalls.push([failed, awaiting, sent]); return 0; },
    readRetentionSettings: async () => ({ sentSourceRetentionDays: 7 }),
    claim: async () => null,
  });
  await runDicomRemapProcessingWorkerTick({ owner: "retention-worker", batchSize: 1 });
  assert.equal(cleanupCalls[0]?.[2], 168);
  __dicomRemapProcessingWorkerTestables.setDependencies({
    releaseRecoveries: async () => 0,
    cleanup: async (failed, awaiting, sent) => { cleanupCalls.push([failed, awaiting, sent]); return 0; },
    readRetentionSettings: async () => { throw new Error("settings unavailable"); },
    claim: async () => null,
  });
  await runDicomRemapProcessingWorkerTick({ owner: "retention-read-failure-worker", batchSize: 1 });
  assert.equal(cleanupCalls[1]?.[2], undefined);
});

test("processing worker continues after one claimed job fails", async () => {
  const jobs = [
    { job: { id: 11 } as never, recovered: false },
    { job: { id: 12 } as never, recovered: false },
    null,
  ];
  const processed: number[] = [];
  __dicomRemapProcessingWorkerTestables.setDependencies({
    releaseRecoveries: async () => 0,
    cleanup: async () => 0,
    claim: async () => jobs.shift() as never,
    process: async ({ job }) => {
      processed.push(Number(job.id));
      if (job.id === 11) throw new Error("simulated processing failure");
      return job as never;
    },
  });
  const result = await runDicomRemapProcessingWorkerTick({ owner: "test-worker", batchSize: 3, leaseSeconds: 120 });
  assert.deepEqual(result, { claimed: 2, completed: 1, failed: 1 });
  assert.deepEqual(processed, [11, 12]);
});

test("processing concurrency defaults to four and clamps to one through eight", () => {
  assert.equal(__dicomRemapProcessingWorkerTestables.normalizeProcessingConcurrency(undefined), 4);
  assert.equal(__dicomRemapProcessingWorkerTestables.normalizeProcessingConcurrency("invalid"), 4);
  assert.equal(__dicomRemapProcessingWorkerTestables.normalizeProcessingConcurrency(0), 1);
  assert.equal(__dicomRemapProcessingWorkerTestables.normalizeProcessingConcurrency(99), 8);
});

test("processing worker keeps at most four heavy jobs in flight and claims the fifth only after a lane is free", async () => {
  const jobs = [11, 12, 13, 14, 15];
  const releases = new Map<number, () => void>();
  let inFlight = 0;
  let maxInFlight = 0;
  let claimCount = 0;
  __dicomRemapProcessingWorkerTestables.setDependencies({
    releaseRecoveries: async () => 0,
    cleanup: async () => 0,
    claim: async () => {
      const id = jobs.shift();
      if (!id) return null;
      claimCount += 1;
      return { job: { id } as never, recovered: false };
    },
    process: async ({ job }) => {
      const id = Number(job.id);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => releases.set(id, resolve));
      inFlight -= 1;
      return job as never;
    },
  });

  const tick = runDicomRemapProcessingWorkerTick({ owner: "four-lane-worker", batchSize: 5, leaseSeconds: 120 });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(inFlight, 4);
  assert.equal(claimCount, 4);

  releases.get(11)?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(claimCount, 5);
  assert.equal(inFlight, 4);

  for (const id of [12, 13, 14, 15]) releases.get(id)?.();
  assert.deepEqual(await tick, { claimed: 5, completed: 5, failed: 0 });
  assert.equal(maxInFlight, 4);
});

test("one lane failure does not stop the other processing lanes", async () => {
  const jobs = [21, 22, 23, 24];
  const completed: number[] = [];
  __dicomRemapProcessingWorkerTestables.setDependencies({
    releaseRecoveries: async () => 0,
    cleanup: async () => 0,
    claim: async () => {
      const id = jobs.shift();
      return id ? { job: { id } as never, recovered: false } : null;
    },
    process: async ({ job }) => {
      if (job.id === 21) throw new Error("simulated lane failure");
      completed.push(Number(job.id));
      return job as never;
    },
  });
  const result = await runDicomRemapProcessingWorkerTick({ owner: "isolated-failure-worker", batchSize: 4, concurrency: 4, leaseSeconds: 120 });
  assert.deepEqual(result, { claimed: 4, completed: 3, failed: 1 });
  assert.deepEqual(completed.sort((a, b) => a - b), [22, 23, 24]);
});

test("graceful worker stop prevents interval claims", async () => {
  let claims = 0;
  __dicomRemapProcessingWorkerTestables.setDependencies({
    releaseRecoveries: async () => 0,
    cleanup: async () => 0,
    claim: async () => {
      claims += 1;
      return null;
    },
  });
  const worker = await startDicomRemapProcessingWorker({ intervalMs: 10_000, batchSize: 1, leaseSeconds: 120 });
  const startupClaims = claims;
  await worker.stop();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(claims, startupClaims);
});

test("graceful worker stop waits for in-flight processing to settle", async () => {
  __dicomRemapProcessingWorkerTestables.setDependencies({ releaseRecoveries: async () => 0, cleanup: async () => 0, claim: async () => null });
  const worker = await startDicomRemapProcessingWorker({ intervalMs: 10_000, batchSize: 1, concurrency: 1, leaseSeconds: 120 });
  let release: () => void = () => { throw new Error("processing lane did not start"); };
  let entered = false;
  __dicomRemapProcessingWorkerTestables.setDependencies({
    releaseRecoveries: async () => 0,
    cleanup: async () => 0,
    claim: async () => entered ? null : { job: { id: 31 } as never, recovered: false },
    process: async ({ job }) => {
      entered = true;
      await new Promise<void>((resolve) => { release = resolve; });
      return job as never;
    },
  });
  const tick = runDicomRemapProcessingWorkerTick({ owner: "shutdown-worker", batchSize: 1, concurrency: 1, leaseSeconds: 120 });
  await new Promise((resolve) => setImmediate(resolve));
  let stopped = false;
  const stopping = worker.stop().then(() => { stopped = true; });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(stopped, false);
  release();
  await tick;
  await stopping;
  assert.equal(stopped, true);
});

test("cleanup failure does not prevent processing claims", async () => {
  let claimed = false;
  __dicomRemapProcessingWorkerTestables.setDependencies({
    releaseRecoveries: async () => 0,
    cleanup: async () => { throw new Error("cleanup unavailable"); },
    claim: async () => {
      if (claimed) return null;
      claimed = true;
      return { job: { id: 13 } as never, recovered: false };
    },
    process: async ({ job }) => job as never,
  });
  const result = await runDicomRemapProcessingWorkerTick({ owner: "test-worker", batchSize: 1, leaseSeconds: 120 });
  assert.deepEqual(result, { claimed: 1, completed: 1, failed: 0 });
});
