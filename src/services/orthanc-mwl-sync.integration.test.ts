import { after, afterEach, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../db/pool.js";
import {
  canReachDatabase,
  cleanupTestData,
  isDatabaseAvailable,
  seedTestData,
  setupTestDatabase,
  type TestData,
} from "../modules/appointments-v2/tests/integration/helpers.js";
import { formatV2AccessionNumber } from "../modules/appointments-v2/shared/utils/accession.js";
import { updateBookingStatusManual } from "../modules/appointments-v2/booking/services/status-booking.service.js";
import { enqueueOrthancSyncForBooking } from "./mwl-sync-service.js";
import { probeOrthancWorklistApi, upsertBookingToOrthanc } from "./orthanc-mwl-adapter.js";
import { startOrthancMwlWorker } from "./orthanc-mwl-worker-service.js";
import { reconcileOrthancMwlProjection } from "./orthanc-mwl-reconcile-service.js";

const PREFIX = "OM_";
const skipEnv = !isDatabaseAvailable() ? "DATABASE_URL not set" : undefined;
const orthancSettingKeys = [
  "enabled",
  "connection_mode",
  "base_url",
  "timeout_seconds",
  "verify_tls",
  "send_only_when_patient_enters_queue",
  "strategy_preference",
] as const;

type SavedSetting = {
  setting_key: string;
  setting_value: unknown;
  updated_by_user_id: number | null;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installOrthancFetch(
  handler: (url: URL, method: string) => Promise<Response> | Response
): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return handler(url, String(init?.method || "GET").toUpperCase());
  }) as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function restoreEnvironmentValue(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

async function waitForOutbox(bookingId: number, operation: "upsert" | "delete"): Promise<{ status: string }> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = await pool.query<{ status: string }>(
      `select status from external_mwl_outbox where booking_id=$1 and external_system='orthanc' and operation=$2 order by id desc limit 1`,
      [bookingId, operation]
    );
    if (result.rows[0]) return result.rows[0];
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for Orthanc ${operation} outbox for booking ${bookingId}.`);
}

describe("Orthanc MWL verified synchronization", { skip: skipEnv }, () => {
  let testData: TestData;
  let savedSettings: SavedSetting[] = [];
  const bookingIds: number[] = [];
  let restoreFetch: (() => void) | null = null;
  let originalInstanceId: string | undefined;
  let originalRole: string | undefined;
  let originalBuildSha: string | undefined;

  before(async () => {
    if (!await canReachDatabase()) return;
    originalInstanceId = process.env.RISPRO_INSTANCE_ID;
    originalRole = process.env.RISPRO_PROCESS_ROLE;
    originalBuildSha = process.env.RISPRO_BUILD_COMMIT_SHA;
    await setupTestDatabase(PREFIX);
    testData = await seedTestData("appointments_v2", PREFIX);
    savedSettings = (await pool.query<SavedSetting>(
      `select setting_key, setting_value, updated_by_user_id from system_settings where category='orthanc_mwl_sync' and setting_key=any($1::text[])`,
      [orthancSettingKeys]
    )).rows;
    await Promise.all([
      ["enabled", "true"],
      ["connection_mode", "external"],
      ["base_url", "http://orthanc.test:8042"],
      ["timeout_seconds", "2"],
      ["verify_tls", "true"],
      ["send_only_when_patient_enters_queue", "false"],
      ["strategy_preference", "put_first"],
    ].map(([settingKey, value]) => pool.query(
      `insert into system_settings(category, setting_key, setting_value) values('orthanc_mwl_sync',$1,$2::jsonb)
       on conflict(category,setting_key) do update set setting_value=excluded.setting_value,updated_at=now()`,
      [settingKey, JSON.stringify({ value })]
    )));
  });

  afterEach(async () => {
    restoreFetch?.();
    restoreFetch = null;
    if (bookingIds.length > 0) {
      await pool.query("delete from appointments_v2.bookings where id=any($1::bigint[])", [bookingIds.splice(0)]);
    }
    restoreEnvironmentValue("RISPRO_INSTANCE_ID", originalInstanceId);
    restoreEnvironmentValue("RISPRO_PROCESS_ROLE", originalRole);
    restoreEnvironmentValue("RISPRO_BUILD_COMMIT_SHA", originalBuildSha);
  });

  after(async () => {
    if (!testData) return;
    for (const settingKey of orthancSettingKeys) {
      const prior = savedSettings.find((entry) => entry.setting_key === settingKey);
      if (prior) {
        await pool.query(
          `update system_settings set setting_value=$2::jsonb,updated_by_user_id=$3,updated_at=now()
           where category='orthanc_mwl_sync' and setting_key=$1`,
          [settingKey, JSON.stringify(prior.setting_value), prior.updated_by_user_id]
        );
      } else {
        await pool.query("delete from system_settings where category='orthanc_mwl_sync' and setting_key=$1", [settingKey]);
      }
    }
    await cleanupTestData(PREFIX);
  });

  async function createBooking(status: "scheduled" | "arrived" | "waiting" = "arrived"): Promise<number> {
    const booking = await pool.query<{ id: number }>(
      `insert into appointments_v2.bookings(patient_id,modality_id,exam_type_id,booking_date,case_category,status,policy_version_id)
       values($1,$2,$3,'2037-05-14','non_oncology',$4,$5) returning id`,
      [testData.patientId, testData.modalityId, testData.examTypeId, status, testData.policyVersionId]
    );
    const bookingId = Number(booking.rows[0]!.id);
    bookingIds.push(bookingId);
    return bookingId;
  }

  async function runWorkerForQueuedBooking(bookingId: number, verifyPayload: (id: number) => unknown): Promise<void> {
    await enqueueOrthancSyncForBooking(bookingId);
    restoreFetch = installOrthancFetch((url, method) => {
      if (method === "GET" && url.pathname === "/system") return jsonResponse({ Version: "1.12.0" });
      if (method === "GET" && url.pathname === "/worklists") return jsonResponse([]);
      if (method === "PUT" && url.pathname === `/worklists/rispro-v2-booking-${bookingId}`) return jsonResponse({ ID: `rispro-v2-booking-${bookingId}` });
      if (method === "GET" && url.pathname === `/worklists/rispro-v2-booking-${bookingId}`) {
        const payload = verifyPayload(bookingId);
        return payload instanceof Response ? payload : jsonResponse(payload);
      }
      throw new Error(`Unexpected Orthanc request ${method} ${url.pathname}`);
    });
    const worker = await startOrthancMwlWorker({ intervalMs: 60_000, batchSize: 1 });
    await worker?.stop();
  }

  it("sets a meaningful PostgreSQL application_name for the web process", async () => {
    const current = await pool.query<{ application_name: string }>("select current_setting('application_name') as application_name");
    assert.match(current.rows[0]?.application_name || "", /^rispro:web:/);
  });

  it("marks an upsert synced only after a successful verification GET and logs safe worker identity", async () => {
    const bookingId = await createBooking();
    const logs: string[] = [];
    const originalInfo = console.info;
    process.env.RISPRO_INSTANCE_ID = "mwl-sync-test";
    process.env.RISPRO_PROCESS_ROLE = "web";
    process.env.RISPRO_BUILD_COMMIT_SHA = "0123456789abcdef";
    console.info = (value?: unknown) => { logs.push(String(value)); };
    try {
      await runWorkerForQueuedBooking(bookingId, (id) => ({ Tags: { AccessionNumber: formatV2AccessionNumber(id) } }));
    } finally {
      console.info = originalInfo;
    }

    const state = await pool.query<{ status: string; sync_status: string; external_worklist_id: string }>(
      `select o.status,s.sync_status,s.external_worklist_id from external_mwl_outbox o join external_mwl_sync s on s.booking_id=o.booking_id and s.external_system='orthanc' where o.booking_id=$1 order by o.id desc limit 1`,
      [bookingId]
    );
    assert.deepEqual(state.rows[0], {
      status: "completed",
      sync_status: "synced",
      external_worklist_id: `rispro-v2-booking-${bookingId}`,
    });
    const serialized = logs.join("\n");
    assert.match(serialized, /"risproInstanceId":"mwl-sync-test"/);
    assert.match(serialized, /"processRole":"web"/);
    assert.match(serialized, /"buildCommitSha":"0123456789abcdef"/);
    assert.match(serialized, /"orthancTarget":"http:\/\/orthanc\.test:8042"/);
    assert.doesNotMatch(serialized, /password|patient/i);
  });

  it("does not mark the outbox complete or synced when verification returns 404", async () => {
    const bookingId = await createBooking();
    await runWorkerForQueuedBooking(bookingId, () => jsonResponse({}, 404));
    const state = await pool.query<{ status: string; sync_status: string }>(
      `select o.status,s.sync_status from external_mwl_outbox o join external_mwl_sync s on s.booking_id=o.booking_id and s.external_system='orthanc' where o.booking_id=$1 order by o.id desc limit 1`,
      [bookingId]
    );
    assert.deepEqual(state.rows[0], { status: "failed", sync_status: "failed" });
  });

  it("does not mark the outbox synced when verification returns the wrong accession", async () => {
    const bookingId = await createBooking();
    await runWorkerForQueuedBooking(bookingId, (id) => ({ Tags: { AccessionNumber: formatV2AccessionNumber(id + 1) } }));
    const state = await pool.query<{ status: string; sync_status: string }>(
      `select o.status,s.sync_status from external_mwl_outbox o join external_mwl_sync s on s.booking_id=o.booking_id and s.external_system='orthanc' where o.booking_id=$1 order by o.id desc limit 1`,
      [bookingId]
    );
    assert.deepEqual(state.rows[0], { status: "failed", sync_status: "failed" });
  });

  it("resolves a POST-created ID by live accession only when the match is unambiguous", async () => {
    const bookingId = await createBooking();
    await pool.query(
      `update system_settings set setting_value='{"value":"post_first"}'::jsonb where category='orthanc_mwl_sync' and setting_key='strategy_preference'`
    );
    let enumerationCount = 0;
    restoreFetch = installOrthancFetch((url, method) => {
      if (method === "GET" && url.pathname === "/worklists") {
        enumerationCount += 1;
        return jsonResponse(enumerationCount === 1 ? [] : ["actual-post-id"]);
      }
      if (method === "POST" && url.pathname === "/worklists") return jsonResponse({}, 201);
      if (method === "GET" && url.pathname === "/worklists/actual-post-id") {
        return jsonResponse({ Tags: { AccessionNumber: formatV2AccessionNumber(bookingId) } });
      }
      if (method === "GET" && url.pathname === `/worklists/rispro-v2-booking-${bookingId}`) return jsonResponse({}, 404);
      throw new Error(`Unexpected Orthanc request ${method} ${url.pathname}`);
    });
    const result = await upsertBookingToOrthanc(bookingId);
    assert.deepEqual(result, { externalWorklistId: "actual-post-id", strategy: "post_collection" });
    await pool.query(
      `update system_settings set setting_value='{"value":"put_first"}'::jsonb where category='orthanc_mwl_sync' and setting_key='strategy_preference'`
    );
  });

  it("reports absent live worklists and applies a normal repair enqueue", async () => {
    const bookingId = await createBooking();
    await pool.query(
      `insert into external_mwl_sync(booking_id,external_system,external_worklist_id,sync_status,payload_hash) values($1,'orthanc','stale-id','synced','hash')`,
      [bookingId]
    );
    restoreFetch = installOrthancFetch((url, method) => {
      if (method === "GET" && url.pathname === "/system") return jsonResponse({ Version: "1.12.0" });
      if (method === "GET" && url.pathname === "/worklists") return jsonResponse([]);
      throw new Error(`Unexpected Orthanc request ${method} ${url.pathname}`);
    });
    const result = await reconcileOrthancMwlProjection({ dateFrom: "2037-05-14", dateTo: "2037-05-14", apply: true });
    assert.deepEqual(result.liveMissing, [bookingId]);
    assert.equal(result.liveCheck.ok, true);
    assert.deepEqual(result.repaired.enqueuedBookingIds, [bookingId]);
    assert.equal((await waitForOutbox(bookingId, "upsert")).status, "pending");
  });

  it("adopts one matching live worklist when the stored UUID is stale without queueing a duplicate", async () => {
    const bookingId = await createBooking();
    await pool.query(
      `insert into external_mwl_sync(booking_id,external_system,external_worklist_id,sync_status,payload_hash) values($1,'orthanc','stale-id','synced',null)`,
      [bookingId]
    );
    restoreFetch = installOrthancFetch((url, method) => {
      if (method === "GET" && url.pathname === "/system") return jsonResponse({ Version: "1.12.0" });
      if (method === "GET" && url.pathname === "/worklists") return jsonResponse(["live-id"]);
      if (method === "GET" && url.pathname === "/worklists/live-id") return jsonResponse({ Tags: { AccessionNumber: formatV2AccessionNumber(bookingId) } });
      throw new Error(`Unexpected Orthanc request ${method} ${url.pathname}`);
    });
    const result = await reconcileOrthancMwlProjection({ dateFrom: "2037-05-14", dateTo: "2037-05-14", apply: true });
    assert.deepEqual(result.liveIdMismatches, [{ bookingId, storedExternalWorklistId: "stale-id", liveWorklistId: "live-id" }]);
    assert.deepEqual(result.repaired.adoptedBookingIds, [bookingId]);
    assert.equal(Number((await pool.query<{ count: string }>(`select count(*)::text as count from external_mwl_outbox where booking_id=$1`, [bookingId])).rows[0]!.count), 0);
    assert.equal((await pool.query<{ external_worklist_id: string }>(`select external_worklist_id from external_mwl_sync where booking_id=$1`, [bookingId])).rows[0]?.external_worklist_id, "live-id");
  });

  it("reconstructs a missing projection from one matching live worklist without queueing a duplicate", async () => {
    const bookingId = await createBooking();
    restoreFetch = installOrthancFetch((url, method) => {
      if (method === "GET" && url.pathname === "/system") return jsonResponse({ Version: "1.12.0" });
      if (method === "GET" && url.pathname === "/worklists") return jsonResponse(["adopted-live-id"]);
      if (method === "GET" && url.pathname === "/worklists/adopted-live-id") return jsonResponse({ Tags: { AccessionNumber: formatV2AccessionNumber(bookingId) } });
      throw new Error(`Unexpected Orthanc request ${method} ${url.pathname}`);
    });
    const result = await reconcileOrthancMwlProjection({ dateFrom: "2037-05-14", dateTo: "2037-05-14", apply: true });
    assert.deepEqual(result.liveIdMismatches, [{ bookingId, storedExternalWorklistId: null, liveWorklistId: "adopted-live-id" }]);
    assert.deepEqual(result.repaired.adoptedBookingIds, [bookingId]);
    assert.equal(Number((await pool.query<{ count: string }>(`select count(*)::text as count from external_mwl_outbox where booking_id=$1`, [bookingId])).rows[0]!.count), 0);
    assert.equal((await pool.query<{ external_worklist_id: string }>(`select external_worklist_id from external_mwl_sync where booking_id=$1`, [bookingId])).rows[0]?.external_worklist_id, "adopted-live-id");
  });

  it("keeps DB reconciliation visible but does not apply repairs when live Orthanc cannot be read", async () => {
    const bookingId = await createBooking();
    restoreFetch = installOrthancFetch(() => { throw new Error("Orthanc unavailable"); });
    const result = await reconcileOrthancMwlProjection({ dateFrom: "2037-05-14", dateTo: "2037-05-14", apply: true });
    assert.equal(result.liveCheck.ok, false);
    assert.match(result.liveCheck.error || "", /Orthanc request failed/i);
    assert.deepEqual(result.missing, [bookingId]);
    assert.deepEqual(result.liveMissing, []);
    assert.deepEqual(result.repaired.enqueuedBookingIds, []);
  });

  it("reports live duplicates without deleting or enqueuing another worklist", async () => {
    const bookingId = await createBooking();
    restoreFetch = installOrthancFetch((url, method) => {
      if (method === "GET" && url.pathname === "/system") return jsonResponse({ Version: "1.12.0" });
      if (method === "GET" && url.pathname === "/worklists") return jsonResponse(["duplicate-a", "duplicate-b"]);
      if (method === "GET" && /^\/worklists\/duplicate-[ab]$/.test(url.pathname)) {
        return jsonResponse({ Tags: { AccessionNumber: formatV2AccessionNumber(bookingId) } });
      }
      if (method === "DELETE") throw new Error("duplicates must not be deleted");
      throw new Error(`Unexpected Orthanc request ${method} ${url.pathname}`);
    });
    const result = await reconcileOrthancMwlProjection({ dateFrom: "2037-05-14", dateTo: "2037-05-14", apply: true });
    assert.deepEqual(result.liveDuplicates, [{ bookingId, worklistIds: ["duplicate-a", "duplicate-b"] }]);
    assert.deepEqual(result.repaired.enqueuedBookingIds, []);
  });

  it("uses only non-mutating GET requests for the capability probe", async () => {
    const calls: Array<{ method: string; path: string }> = [];
    restoreFetch = installOrthancFetch((url, method) => {
      calls.push({ method, path: url.pathname });
      if (url.pathname === "/system") return jsonResponse({ Version: "1.12.0" });
      if (url.pathname === "/worklists") return jsonResponse([]);
      throw new Error(`Unexpected Orthanc request ${method} ${url.pathname}`);
    });
    const probe = await probeOrthancWorklistApi();
    assert.deepEqual(calls, [{ method: "GET", path: "/system" }, { method: "GET", path: "/worklists" }]);
    assert.equal(probe.worklistsPostSupported, null);
    assert.equal(probe.worklistsCreateSupported, null);
  });

  it("re-enqueues Orthanc MWL after an arrived booking is completed and returned to the queue", async () => {
    const bookingId = await createBooking("arrived");
    await updateBookingStatusManual(bookingId, "completed", "Completed scan", testData.userId, "supervisor");
    assert.equal((await waitForOutbox(bookingId, "delete")).status, "pending");
    await updateBookingStatusManual(bookingId, "arrived", "Returned for a fresh scan", testData.userId, "supervisor");
    assert.equal((await waitForOutbox(bookingId, "upsert")).status, "pending");
  });
});
