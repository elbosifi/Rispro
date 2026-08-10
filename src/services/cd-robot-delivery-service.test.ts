import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "../db/pool.js";
import { HttpError } from "../utils/http-error.js";
import { __cdRobotDeliveryTestables, attemptCdRobotDelivery, monitorCdRobotDeliveries, startCdRobotDelivery } from "./cd-robot-delivery-service.js";

const originalQuery = pool.query.bind(pool);
const originalConnect = pool.connect.bind(pool);
const booking = { id: 11, patient_id: 4, status: "completed", study_instance_uid: "1.2.3", accession_number: "V2-000011", patient_primary_id: "P4", national_id: null, mrn: null, modality_code: "CT", booking_date: "2026-08-10" };
const destination = { key: "Robot 1", aet: "ROBOT", host: "10.0.0.5", port: 104, isDefault: false, isCdRobot: true, configurationError: null };
function delivery(overrides: Record<string, unknown> = {}) {
  return { id: 31, patient_id: 4, booking_id: 11, study_instance_uid: "1.2.3", destination_key: "Robot 1", orthanc_study_id: null, orthanc_job_id: null, status: "sending", attempt_count: 1, resend_reason_code: null, resend_reason_text: null, requested_by_user_id: 7, requested_at: "2026-08-10T00:00:00.000Z", completed_at: null, last_checked_at: null, last_error: null, ...overrides };
}
function result(rows: unknown[] = [], rowCount = rows.length) { return { rows, rowCount } as never; }
function installClient(overrides: Record<string, unknown> = {}) {
  const client = {
    findStudy: async () => ({ status: "matched", study: { orthancStudyId: "study-1", patientId: "P4", modalitiesInStudy: ["CT"], studyDate: "20260810" } }),
    assertStudyStableAndNonEmpty: async () => ({ orthancStudyId: "study-1" }),
    echoRemoteModality: async () => {},
    enqueueStudyStore: async () => "job-1",
    getJob: async () => ({ State: "Running" }),
    ...overrides,
  };
  __cdRobotDeliveryTestables.setDependenciesForTests({ listRemoteModalities: async () => ({ modalities: [destination] }), synchronizeCdRobots: async () => {}, createClient: async () => client as never, resolveAlias: async () => "rispro_cd_robot_1" });
  return client;
}
test.afterEach(() => {
  (pool as unknown as { query: typeof pool.query }).query = originalQuery;
  (pool as unknown as { connect: typeof pool.connect }).connect = originalConnect;
  __cdRobotDeliveryTestables.resetTestOverrides();
});

test("C-ECHO failure retries exactly once", async () => {
  let claims = 0; let echoes = 0; let stores = 0;
  installClient({ echoRemoteModality: async () => { echoes += 1; if (echoes === 1) throw new Error("echo timeout"); }, enqueueStudyStore: async () => { stores += 1; return "job-1"; } });
  (pool as unknown as { query: (sql: string) => Promise<unknown> }).query = async (sql) => {
    if (sql.includes("attempt_count=attempt_count+1")) return result([delivery({ attempt_count: ++claims })]);
    if (sql.includes("from appointments_v2.bookings")) return result([booking]);
    if (sql.includes("orthanc_study_id=$2")) return result([delivery({ attempt_count: 2, orthanc_job_id: "job-1" })]);
    if (sql.includes("select * from cd_robot_deliveries")) return result([delivery({ status: "failed" })]);
    return result();
  };
  const sent = await attemptCdRobotDelivery(31);
  assert.equal(claims, 2); assert.equal(echoes, 2); assert.equal(stores, 1); assert.equal(sent.orthanc_job_id, "job-1");
});

test("deterministic study failures do not automatically retry", async () => {
  let claims = 0;
  installClient({ findStudy: async () => ({ status: "not_found", study: null }) });
  (pool as unknown as { query: (sql: string) => Promise<unknown> }).query = async (sql) => {
    if (sql.includes("attempt_count=attempt_count+1")) return result([delivery({ attempt_count: ++claims })]);
    if (sql.includes("from appointments_v2.bookings")) return result([booking]);
    if (sql.includes("select * from cd_robot_deliveries")) return result([delivery({ status: "failed" })]);
    return result();
  };
  await attemptCdRobotDelivery(31);
  assert.equal(claims, 1);
});

test("incomplete studies do not automatically retry", async () => {
  let claims = 0;
  installClient({ assertStudyStableAndNonEmpty: async () => { throw new HttpError(409, "Study is not complete."); } });
  (pool as unknown as { query: (sql: string) => Promise<unknown> }).query = async (sql) => {
    if (sql.includes("attempt_count=attempt_count+1")) return result([delivery({ attempt_count: ++claims })]);
    if (sql.includes("from appointments_v2.bookings")) return result([booking]);
    if (sql.includes("select * from cd_robot_deliveries")) return result([delivery({ status: "failed" })]);
    return result();
  };
  await attemptCdRobotDelivery(31);
  assert.equal(claims, 1);
});

test("an uncertain C-STORE submission does not submit a second store", async () => {
  let claims = 0; let stores = 0;
  installClient({ enqueueStudyStore: async () => { stores += 1; throw new HttpError(503, "Orthanc timed out", { code: "orthanc_timeout" }); } });
  (pool as unknown as { query: (sql: string) => Promise<unknown> }).query = async (sql) => {
    if (sql.includes("attempt_count=attempt_count+1")) return result([delivery({ attempt_count: ++claims })]);
    if (sql.includes("from appointments_v2.bookings")) return result([booking]);
    if (sql.includes("select * from cd_robot_deliveries")) return result([delivery({ status: "failed", last_error: "uncertain" })]);
    return result();
  };
  await attemptCdRobotDelivery(31);
  assert.equal(claims, 1); assert.equal(stores, 1);
});

test("terminal Orthanc job failure retries exactly once and stale no-job sends are terminally failed", async () => {
  let claims = 1; let stores = 0; let staleUpdate = false;
  installClient({ getJob: async () => ({ State: "Failure" }), enqueueStudyStore: async () => { stores += 1; return "job-2"; } });
  (pool as unknown as { query: (sql: string) => Promise<unknown> }).query = async (sql) => {
    if (sql.includes("requested_at < now()-interval")) { staleUpdate = true; return result(); }
    if (sql.includes("orthanc_job_id is not null")) return result([delivery({ orthanc_job_id: "job-1", attempt_count: 1 })]);
    if (sql.includes("attempt_count=attempt_count+1")) return result([delivery({ attempt_count: ++claims })]);
    if (sql.includes("from appointments_v2.bookings")) return result([booking]);
    if (sql.includes("orthanc_study_id=$2")) return result([delivery({ orthanc_job_id: "job-2", attempt_count: 2 })]);
    return result();
  };
  await monitorCdRobotDeliveries();
  assert.equal(staleUpdate, true); assert.equal(claims, 2); assert.equal(stores, 1);
});

test("patient lock check precedes resend count, blocking a concurrent same-patient resend", async () => {
  const calls: string[] = [];
  installClient();
  (pool as unknown as { query: (sql: string) => Promise<unknown> }).query = async (sql) => sql.includes("from appointments_v2.bookings") ? result([booking]) : result();
  (pool as unknown as { connect: () => Promise<unknown> }).connect = async () => ({ query: async (sql: string) => { calls.push(sql); if (sql.includes("status='sending'")) return result([{ "?column?": 1 }]); if (sql.includes("count(*)")) throw new Error("resend count must not run while active"); return result(); }, release() {} }) as never;
  await assert.rejects(() => startCdRobotDelivery({ bookingId: 11, destinationKey: "Robot 1", userId: 7, resendReasonCode: "patient_requested_additional_copy" }), /already has a CD send/i);
  assert.ok(calls.findIndex((sql) => sql.includes("for update")) < calls.findIndex((sql) => sql.includes("status='sending'")));
});

test("a resend validates the freshly counted success after the patient lock is acquired", async () => {
  installClient();
  (pool as unknown as { query: (sql: string) => Promise<unknown> }).query = async (sql) => sql.includes("from appointments_v2.bookings") ? result([booking]) : result();
  (pool as unknown as { connect: () => Promise<unknown> }).connect = async () => ({ query: async (sql: string) => {
    if (sql.includes("status='sending'")) return result();
    if (sql.includes("count(*)")) return result([{ count: "1" }]);
    if (sql.includes("insert into cd_robot_deliveries")) throw new Error("must not create an unreasoned resend");
    return result();
  }, release() {} }) as never;
  await assert.rejects(() => startCdRobotDelivery({ bookingId: 11, destinationKey: "Robot 1", userId: 7 }), /reason for the additional CD is required/i);
});

test("a different patient is not rejected by the active-patient predicate", async () => {
  const activePatientIds: unknown[] = [];
  installClient();
  (pool as unknown as { query: (sql: string) => Promise<unknown> }).query = async (sql) => sql.includes("from appointments_v2.bookings") ? result([{ ...booking, patient_id: 8 }]) : result();
  (pool as unknown as { connect: () => Promise<unknown> }).connect = async () => ({ query: async (sql: string, values?: unknown[]) => { if (sql.includes("status='sending'")) { activePatientIds.push(values?.[0]); return result(); } if (sql.includes("count(*)")) return result([{ count: "0" }]); if (sql.includes("insert into cd_robot_deliveries")) return result([delivery({ patient_id: 8 })]); return result(); }, release() {} }) as never;
  (pool as unknown as { query: (sql: string) => Promise<unknown> }).query = async (sql) => {
    if (sql.includes("from appointments_v2.bookings")) return result([{ ...booking, patient_id: 8 }]);
    if (sql.includes("attempt_count=attempt_count+1")) return result();
    if (sql.includes("select * from cd_robot_deliveries")) return result([delivery({ patient_id: 8 })]);
    return result();
  };
  await startCdRobotDelivery({ bookingId: 11, destinationKey: "Robot 1", userId: 7 });
  assert.deepEqual(activePatientIds, [8]);
});
