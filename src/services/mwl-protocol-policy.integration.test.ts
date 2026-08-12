import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { pool } from "../db/pool.js";
import { invalidateAllCache } from "../utils/cache.js";
import { errorHandler } from "../middleware/error-handler.js";
import { settingsRouter } from "../routes/settings.js";
import {
  canReachDatabase,
  createTestAuthCookie,
  createTestSupervisorReauthCookie,
  fetchJson,
} from "../modules/appointments-v2/tests/integration/helpers.js";
import { cancelProtocolAssignment, saveProtocolAssignment } from "../modules/doctor-portal/protocoling-repository.js";
import {
  reconcileMwlProtocolPolicyChange,
  syncBookingWorklistSources,
} from "./dicom-service.js";
import {
  claimOrthancOutboxBatch,
  enqueueOrthancSyncForBooking,
  markOrthancOutboxFailure,
  markOrthancOutboxSuccess,
} from "./mwl-sync-service.js";
import {
  claimSanteOutboxBatch,
  enqueueSanteHl7ForBooking,
  markSanteOutboxFailure,
  retrySanteOutbox,
  writeSanteOutboxJob,
} from "./sante-hl7-outbox-service.js";
import { getWorklistMonitorEntries } from "./worklist-monitor-service.js";
import {
  MWL_POLICY_CATEGORY,
  REQUIRE_PROTOCOL_BEFORE_MWL_KEY,
  resolveMwlEligibilityForBooking,
} from "./mwl-eligibility-service.js";

type Fixture = {
  userId: number;
  patientId: number;
  policySetId: number;
  policyVersionId: number;
  protocolId: number;
  protocolVersionId: number;
  modalityIds: Record<"ct" | "mri" | "mammo" | "us", number>;
  bookingIds: number[];
};

type SettingSnapshot = { category: string; setting_key: string; setting_value: unknown };

const TEST_DATE = "2042-08-12";
const SETTINGS_CATEGORIES = [MWL_POLICY_CATEGORY, "orthanc_mwl_sync", "sante_worklist_hl7", "dicom_gateway"];
let fixture: Fixture | null = null;
let settingsSnapshot: SettingSnapshot[] = [];
let tempRoot = "";
let santeOutputRoot = "";
let testApp: { baseUrl: string; close: () => Promise<void> } | null = null;

async function createSettingsTestApp(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const express = (await import("express")).default;
  const cookieParser = (await import("cookie-parser")).default;
  const http = await import("node:http");
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/settings", settingsRouter);
  app.use(errorHandler);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function setSetting(category: string, key: string, value: string): Promise<void> {
  await pool.query(
    `insert into system_settings(category, setting_key, setting_value)
     values ($1, $2, $3::jsonb)
     on conflict(category, setting_key)
     do update set setting_value=excluded.setting_value, updated_at=now()`,
    [category, key, JSON.stringify({ value })]
  );
  invalidateAllCache();
}

async function createBooking(modality: keyof Fixture["modalityIds"], status = "scheduled"): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `insert into appointments_v2.bookings(
       patient_id, modality_id, booking_date, booking_time, case_category, status,
       policy_version_id, capacity_resolution_mode, uses_special_quota, is_walk_in, created_by_user_id
     ) values ($1, $2, $3::date, '09:00', 'non_oncology', $4, $5, 'standard', false, false, $6)
     returning id`,
    [fixture!.patientId, fixture!.modalityIds[modality], TEST_DATE, status, fixture!.policyVersionId, fixture!.userId]
  );
  const bookingId = Number(result.rows[0]!.id);
  fixture!.bookingIds.push(bookingId);
  return bookingId;
}

async function addFreeTextAssignment(bookingId: number, status: "ASSIGNED" | "MODIFIED" | "CANCELLED" = "ASSIGNED") {
  await pool.query(
    `insert into appointment_protocol_assignments(
       appointment_id, protocol_id, protocol_version_id, assigned_by, free_text_protocol, status
     ) values ($1, null, null, $2, 'Free text protocol', $3)`,
    [bookingId, fixture!.userId, status]
  );
}

async function clearSync(bookingId: number): Promise<void> {
  await pool.query("delete from external_mwl_outbox where booking_id=$1", [bookingId]);
  await pool.query("delete from external_mwl_sync where booking_id=$1", [bookingId]);
  await pool.query("delete from sante_hl7_outbox where booking_id=$1", [bookingId]);
  await pool.query("delete from sante_worklist_sync where booking_id=$1", [bookingId]);
}

async function waitFor<T>(loader: () => Promise<T | null>, message: string, timeoutMs = 5000): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await loader();
    if (result !== null) return result;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${message}.`);
}

async function latestOrthancOperation(bookingId: number): Promise<string | null> {
  const { rows } = await pool.query<{ operation: string }>(
    `select operation from external_mwl_outbox where booking_id=$1 and external_system='orthanc'
     order by updated_at desc, id desc limit 1`,
    [bookingId]
  );
  return rows[0]?.operation ?? null;
}

async function latestSanteEvent(bookingId: number): Promise<string | null> {
  const { rows } = await pool.query<{ event_type: string }>(
    "select event_type from sante_hl7_outbox where booking_id=$1 order by id desc limit 1",
    [bookingId]
  );
  return rows[0]?.event_type ?? null;
}

async function claimOrthancJob(bookingId: number, operation: "upsert" | "delete") {
  const jobs = await claimOrthancOutboxBatch(500);
  const job = jobs.find((candidate) => candidate.bookingId === bookingId && candidate.operation === operation);
  assert.ok(job, `Expected claimable Orthanc ${operation} for booking ${bookingId}.`);
  return job;
}

async function claimSanteJob(bookingId: number, eventType: "create" | "update" | "cancel") {
  const jobs = await claimSanteOutboxBatch(500);
  const job = jobs.find((candidate) => candidate.bookingId === bookingId && candidate.eventType === eventType);
  assert.ok(job, `Expected claimable Sante ${eventType} for booking ${bookingId}.`);
  return job;
}

async function establishPublishedProjection(bookingId: number): Promise<void> {
  const orthanc = await enqueueOrthancSyncForBooking(bookingId);
  assert.equal(orthanc.operation, "upsert");
  const orthancJob = await claimOrthancJob(bookingId, "upsert");
  await markOrthancOutboxSuccess(orthancJob.id, bookingId, "upsert", `test-${bookingId}`);

  const sante = await enqueueSanteHl7ForBooking(bookingId);
  assert.equal(sante.enqueued, true);
  const santeJob = await claimSanteJob(bookingId, "create");
  await writeSanteOutboxJob(santeJob);
}

async function completeWithdrawal(bookingId: number): Promise<void> {
  const orthancJob = await claimOrthancJob(bookingId, "delete");
  await markOrthancOutboxSuccess(orthancJob.id, bookingId, "delete", `test-${bookingId}`);
  const santeJob = await claimSanteJob(bookingId, "cancel");
  await writeSanteOutboxJob(santeJob);
}

describe("shared MWL protocol policy", () => {
  before(async () => {
    if (!await canReachDatabase()) return;
    settingsSnapshot = (await pool.query<SettingSnapshot>(
      "select category, setting_key, setting_value from system_settings where category=any($1::text[]) order by category, setting_key",
      [SETTINGS_CATEGORIES]
    )).rows;
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-mwl-protocol-policy-"));
    const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
    santeOutputRoot = path.join(process.cwd(), "storage", "sante-hl7-output", `mwl-protocol-${suffix}`);
    await fs.mkdir(santeOutputRoot, { recursive: true });
    const user = await pool.query<{ id: number }>(
      `insert into users(username,password_hash,full_name,role,is_active)
       values($1,'test-hash',$2,'supervisor',true) returning id`,
      [`mwl_protocol_${suffix}`, `MWL Protocol ${suffix}`]
    );
    const userId = Number(user.rows[0]!.id);
    const patient = await pool.query<{ id: number }>(
      `insert into patients(arabic_full_name,english_full_name,national_id,normalized_arabic_name,sex,age_years,phone_1,identifier_type,identifier_value)
       values($1,$1,$2::varchar,$1,'F',40,'0912345678','national_id',$2::varchar) returning id`,
      [`MWL Protocol ${suffix}`, `8${Date.now().toString().slice(-11)}`]
    );
    const policySet = await pool.query<{ id: number }>(
      "insert into appointments_v2.policy_sets(key,name,created_by_user_id) values($1,$2,$3) returning id",
      [`mwl_protocol_${suffix}`, `MWL Protocol ${suffix}`, userId]
    );
    const policyVersion = await pool.query<{ id: number }>(
      `insert into appointments_v2.policy_versions(policy_set_id,version_no,status,config_hash,created_by_user_id,published_at,published_by_user_id)
       values($1,1,'published',$2,$3,now(),$3) returning id`,
      [policySet.rows[0]!.id, `mwl_protocol_${suffix}_hash`, userId]
    );
    const modalityIds = {} as Fixture["modalityIds"];
    const definitions = {
      ct: [`CTX${suffix}`, `CT Scanner ${suffix}`],
      mri: [`MRX${suffix}`, `MRI Scanner ${suffix}`],
      mammo: [`MGX${suffix}`, `Mammography ${suffix}`],
      us: [`USX${suffix}`, `Ultrasound ${suffix}`],
    } as const;
    for (const [key, [code, name]] of Object.entries(definitions) as Array<[keyof typeof definitions, readonly [string, string]]>) {
      const modality = await pool.query<{ id: number }>(
        "insert into modalities(code,name_ar,name_en,daily_capacity,is_active) values($1,$2,$2,20,true) returning id",
        [code, name]
      );
      modalityIds[key] = Number(modality.rows[0]!.id);
    }
    fixture = {
      userId,
      patientId: Number(patient.rows[0]!.id),
      policySetId: Number(policySet.rows[0]!.id),
      policyVersionId: Number(policyVersion.rows[0]!.id),
      protocolId: 0,
      protocolVersionId: 0,
      modalityIds,
      bookingIds: [],
    };
    testApp = await createSettingsTestApp();
    const protocol = await pool.query<{ id: number }>(
      "insert into protocols(name,modality,is_active) values($1,'CT',true) returning id",
      [`Saved CT Protocol ${suffix}`]
    );
    const protocolVersionRow = await pool.query<{ id: number }>(
      `insert into protocol_versions(protocol_id,version_number,status,created_by)
       values($1,'1','ACTIVE',$2) returning id`,
      [protocol.rows[0]!.id, userId]
    );
    await pool.query("update protocols set active_version_id=$2 where id=$1", [protocol.rows[0]!.id, protocolVersionRow.rows[0]!.id]);
    fixture.protocolId = Number(protocol.rows[0]!.id);
    fixture.protocolVersionId = Number(protocolVersionRow.rows[0]!.id);

    await setSetting("orthanc_mwl_sync", "enabled", "true");
    await setSetting("orthanc_mwl_sync", "shadow_mode", "true");
    await setSetting("orthanc_mwl_sync", "base_url", "http://127.0.0.1:8042");
    await setSetting("orthanc_mwl_sync", "send_only_when_patient_enters_queue", "false");
    await setSetting("sante_worklist_hl7", "enabled", "true");
    await setSetting("sante_worklist_hl7", "mode", "shadow");
    await setSetting("sante_worklist_hl7", "delivery_method", "file_drop");
    await setSetting("sante_worklist_hl7", "output_folder_path", santeOutputRoot);
    await setSetting("sante_worklist_hl7", "send_only_when_patient_enters_queue", "false");
    await setSetting("dicom_gateway", "worklist_source_dir", path.join(tempRoot, "source"));
    await setSetting("dicom_gateway", "worklist_output_dir", path.join(tempRoot, "output"));
    await setSetting("dicom_gateway", "mwl_ae_title", "RISPRO_TEST_MWL");
    await setSetting(MWL_POLICY_CATEGORY, REQUIRE_PROTOCOL_BEFORE_MWL_KEY, "disabled");
  });

  after(async () => {
    if (!fixture) return;
    await testApp?.close();
    await clearSyncForBookings(fixture.bookingIds);
    await pool.query("delete from appointments_v2.bookings where id=any($1::bigint[])", [fixture.bookingIds]);
    await pool.query("delete from patients where id=$1", [fixture.patientId]);
    await pool.query("delete from modalities where id=any($1::bigint[])", [Object.values(fixture.modalityIds)]);
    await pool.query("update protocols set active_version_id=null where id=$1", [fixture.protocolId]);
    await pool.query("delete from protocol_versions where id=$1", [fixture.protocolVersionId]);
    await pool.query("delete from protocols where id=$1", [fixture.protocolId]);
    await pool.query("delete from appointments_v2.policy_versions where id=$1", [fixture.policyVersionId]);
    await pool.query("delete from appointments_v2.policy_sets where id=$1", [fixture.policySetId]);
    await pool.query("delete from system_settings where category=any($1::text[])", [SETTINGS_CATEGORIES]);
    await pool.query("delete from audit_log where changed_by_user_id=$1", [fixture.userId]);
    await pool.query("delete from users where id=$1", [fixture.userId]);
    for (const row of settingsSnapshot) {
      await pool.query(
        "insert into system_settings(category,setting_key,setting_value) values($1,$2,$3::jsonb)",
        [row.category, row.setting_key, JSON.stringify(row.setting_value)]
      );
    }
    invalidateAllCache();
    if (tempRoot && path.resolve(tempRoot).startsWith(path.resolve(os.tmpdir()))) {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
    if (santeOutputRoot && path.resolve(santeOutputRoot).startsWith(path.resolve(process.cwd(), "storage", "sante-hl7-output"))) {
      await fs.rm(santeOutputRoot, { recursive: true, force: true });
    }
    await pool.end();
  });

  it("preserves existing publication behavior while disabled", async () => {
    const ct = await createBooking("ct");
    const mri = await createBooking("mri");
    const mammo = await createBooking("mammo");
    const us = await createBooking("us");
    for (const bookingId of [ct, mri, mammo, us]) {
      assert.equal((await resolveMwlEligibilityForBooking(bookingId)).protocolGateSatisfied, true);
      assert.equal((await enqueueOrthancSyncForBooking(bookingId)).operation, "upsert");
      assert.equal((await enqueueSanteHl7ForBooking(bookingId)).enqueued, true);
    }
  });

  it("holds CT and MRI but not Mammo or Ultrasound when enabled", async () => {
    await setSetting(MWL_POLICY_CATEGORY, REQUIRE_PROTOCOL_BEFORE_MWL_KEY, "enabled");
    const ct = await createBooking("ct");
    const mri = await createBooking("mri");
    const mammo = await createBooking("mammo");
    const us = await createBooking("us");
    for (const bookingId of [ct, mri]) {
      assert.equal((await enqueueOrthancSyncForBooking(bookingId)).reason, "waiting_for_protocol");
      assert.equal((await enqueueSanteHl7ForBooking(bookingId)).reason, "waiting_for_protocol");
    }
    for (const bookingId of [mammo, us]) {
      assert.equal((await enqueueOrthancSyncForBooking(bookingId)).operation, "upsert");
      assert.equal((await enqueueSanteHl7ForBooking(bookingId)).enqueued, true);
    }
  });

  it("accepts active free-text assignments and rejects cancelled assignments", async () => {
    const active = await createBooking("ct");
    await addFreeTextAssignment(active, "MODIFIED");
    assert.equal((await resolveMwlEligibilityForBooking(active)).activeProtocolAssignmentExists, true);
    assert.equal((await enqueueOrthancSyncForBooking(active)).operation, "upsert");
    assert.equal((await enqueueSanteHl7ForBooking(active)).enqueued, true);

    const cancelled = await createBooking("mri");
    await addFreeTextAssignment(cancelled, "CANCELLED");
    assert.equal((await resolveMwlEligibilityForBooking(cancelled)).activeProtocolAssignmentExists, false);
    assert.equal((await enqueueOrthancSyncForBooking(cancelled)).reason, "waiting_for_protocol");
    assert.equal((await enqueueSanteHl7ForBooking(cancelled)).reason, "waiting_for_protocol");
  });

  it("accepts an active saved-library protocol assignment", async () => {
    const bookingId = await createBooking("ct");
    await pool.query(
      `insert into appointment_protocol_assignments(
         appointment_id,protocol_id,protocol_version_id,assigned_by,status
       ) values($1,$2,$3,$4,'ASSIGNED')`,
      [bookingId, fixture!.protocolId, fixture!.protocolVersionId, fixture!.userId]
    );
    assert.equal((await resolveMwlEligibilityForBooking(bookingId)).activeProtocolAssignmentExists, true);
    assert.equal((await enqueueOrthancSyncForBooking(bookingId)).operation, "upsert");
    assert.equal((await enqueueSanteHl7ForBooking(bookingId)).enqueued, true);
  });

  it("composes protocol and queue gates in deterministic order", async () => {
    await setSetting("orthanc_mwl_sync", "send_only_when_patient_enters_queue", "true");
    await setSetting("sante_worklist_hl7", "send_only_when_patient_enters_queue", "true");
    const scheduledWithProtocol = await createBooking("ct", "scheduled");
    await addFreeTextAssignment(scheduledWithProtocol);
    assert.equal((await enqueueOrthancSyncForBooking(scheduledWithProtocol)).reason, "waiting_for_patient_queue");
    assert.equal((await enqueueSanteHl7ForBooking(scheduledWithProtocol)).reason, "waiting_for_patient_queue");

    const arrivedWithoutProtocol = await createBooking("ct", "arrived");
    assert.equal((await enqueueOrthancSyncForBooking(arrivedWithoutProtocol)).reason, "waiting_for_protocol");
    assert.equal((await enqueueSanteHl7ForBooking(arrivedWithoutProtocol)).reason, "waiting_for_protocol");

    const arrivedWithProtocol = await createBooking("ct", "arrived");
    await addFreeTextAssignment(arrivedWithProtocol);
    assert.equal((await enqueueOrthancSyncForBooking(arrivedWithProtocol)).operation, "upsert");
    assert.equal((await enqueueSanteHl7ForBooking(arrivedWithProtocol)).enqueued, true);
    await setSetting("orthanc_mwl_sync", "send_only_when_patient_enters_queue", "false");
    await setSetting("sante_worklist_hl7", "send_only_when_patient_enters_queue", "false");
  });

  it("removes embedded MWL files while held and restores them after assignment", async () => {
    const bookingId = await createBooking("ct");
    const held = await syncBookingWorklistSources(bookingId);
    assert.equal(held.removedOnly, true);
    assert.equal(held.reason, "waiting_for_protocol");
    await addFreeTextAssignment(bookingId);
    const published = await syncBookingWorklistSources(bookingId);
    assert.equal(published.removedOnly, false);
    assert.equal(published.files?.length, 1);
  });

  it("assignment publishes automatically and withdrawal durably removes all external projections", async () => {
    const bookingId = await createBooking("ct", "arrived");
    await saveProtocolAssignment(bookingId, {
      protocolId: null,
      scannerId: null,
      protocolNotes: null,
      contrastNotes: null,
      freeTextProtocol: "Triggered free-text protocol",
      status: "ASSIGNED",
    }, fixture!.userId);
    await waitFor(async () => (await latestOrthancOperation(bookingId)) === "upsert" ? "upsert" : null, "Orthanc assignment upsert");
    await waitFor(async () => (await latestSanteEvent(bookingId)) === "create" ? "create" : null, "Sante assignment create");
    const orthancActiveJobs = await pool.query<{ count: string }>(
      `select count(*)::text as count from external_mwl_outbox
       where booking_id=$1 and external_system='orthanc' and status in ('pending','processing','failed')`,
      [bookingId]
    );
    const santeCreateJobs = await pool.query<{ count: string }>(
      "select count(*)::text as count from sante_hl7_outbox where booking_id=$1 and event_type='create' and status <> 'skipped'",
      [bookingId]
    );
    assert.equal(Number(orthancActiveJobs.rows[0]!.count), 1);
    assert.equal(Number(santeCreateJobs.rows[0]!.count), 1);

    await cancelProtocolAssignment(bookingId);
    await waitFor(async () => (await latestOrthancOperation(bookingId)) === "delete" ? "delete" : null, "Orthanc protocol withdrawal");
    await waitFor(async () => (await latestSanteEvent(bookingId)) === "cancel" ? "cancel" : null, "Sante protocol withdrawal");
    const status = await pool.query<{ status: string }>("select status from appointments_v2.bookings where id=$1", [bookingId]);
    assert.equal(status.rows[0]!.status, "arrived");
  });

  it("terminal cleanup is never blocked by missing protocol", async () => {
    await setSetting(MWL_POLICY_CATEGORY, REQUIRE_PROTOCOL_BEFORE_MWL_KEY, "disabled");
    for (const status of ["cancelled", "voided", "discontinued"]) {
      const bookingId = await createBooking("ct", "arrived");
      await enqueueOrthancSyncForBooking(bookingId);
      await enqueueSanteHl7ForBooking(bookingId);
      await pool.query("update appointments_v2.bookings set status=$2 where id=$1", [bookingId, status]);
      await setSetting(MWL_POLICY_CATEGORY, REQUIRE_PROTOCOL_BEFORE_MWL_KEY, "enabled");
      assert.equal((await enqueueOrthancSyncForBooking(bookingId)).operation, "delete");
      assert.equal((await enqueueSanteHl7ForBooking(bookingId)).enqueued, true);
      assert.equal(await latestSanteEvent(bookingId), "cancel");
      await setSetting(MWL_POLICY_CATEGORY, REQUIRE_PROTOCOL_BEFORE_MWL_KEY, "disabled");
    }
  });

  it("Sante worker cannot claim a stale publication job after the booking becomes protocol-ineligible", async () => {
    await setSetting(MWL_POLICY_CATEGORY, REQUIRE_PROTOCOL_BEFORE_MWL_KEY, "disabled");
    const bookingId = await createBooking("ct", "arrived");
    const queued = await enqueueSanteHl7ForBooking(bookingId);
    assert.equal(queued.enqueued, true);
    await setSetting(MWL_POLICY_CATEGORY, REQUIRE_PROTOCOL_BEFORE_MWL_KEY, "enabled");
    const claimed = await claimSanteOutboxBatch(100);
    assert.ok(!claimed.some((job) => job.bookingId === bookingId && job.eventType !== "cancel"));
    const staleJob = await pool.query<{ status: string; last_error: string | null }>(
      "select status,last_error from sante_hl7_outbox where id=$1",
      [queued.jobId]
    );
    assert.equal(staleJob.rows[0]!.status, "skipped");
    assert.equal(staleJob.rows[0]!.last_error, "waiting_for_protocol");
  });

  it("Orthanc worker converts a stale upsert to deletion after the booking becomes protocol-ineligible", async () => {
    await setSetting(MWL_POLICY_CATEGORY, REQUIRE_PROTOCOL_BEFORE_MWL_KEY, "disabled");
    const bookingId = await createBooking("ct", "arrived");
    const queued = await enqueueOrthancSyncForBooking(bookingId);
    assert.equal(queued.operation, "upsert");
    await setSetting(MWL_POLICY_CATEGORY, REQUIRE_PROTOCOL_BEFORE_MWL_KEY, "enabled");
    const claimed = await claimOrthancOutboxBatch(100);
    const job = claimed.find((candidate) => candidate.bookingId === bookingId);
    assert.equal(job?.operation, "delete");
  });

  it("does not convert an obsolete failed Orthanc upsert or hide the required withdrawal", async () => {
    await setSetting(MWL_POLICY_CATEGORY, REQUIRE_PROTOCOL_BEFORE_MWL_KEY, "disabled");
    const bookingId = await createBooking("ct", "arrived");
    const queuedA = await enqueueOrthancSyncForBooking(bookingId);
    const jobA = await claimOrthancJob(bookingId, "upsert");
    assert.equal(jobA.id, queuedA.jobId);
    await markOrthancOutboxFailure(jobA.id, bookingId, "historical upsert failed", 300);

    const insertedB = await pool.query<{ id: number }>(
      `insert into external_mwl_outbox(
         booking_id,external_system,operation,status,attempt_count,next_attempt_at,payload_hash,created_at,updated_at
       ) values ($1,'orthanc','upsert','pending',0,now(),'newer-upsert',now(),now()) returning id`,
      [bookingId]
    );
    const jobBId = Number(insertedB.rows[0]!.id);
    const jobB = await claimOrthancJob(bookingId, "upsert");
    assert.equal(jobB.id, jobBId);
    await markOrthancOutboxSuccess(jobB.id, bookingId, "upsert", `current-${bookingId}`);

    const current = await pool.query<{ sync_status: string; deleted_at: string | null }>(
      "select sync_status,deleted_at::text as deleted_at from external_mwl_sync where booking_id=$1 and external_system='orthanc'",
      [bookingId]
    );
    assert.equal(current.rows[0]!.sync_status, "synced");
    assert.equal(current.rows[0]!.deleted_at, null);

    await setSetting(MWL_POLICY_CATEGORY, REQUIRE_PROTOCOL_BEFORE_MWL_KEY, "enabled");
    assert.ok(!(await claimOrthancOutboxBatch(500)).some((job) => job.bookingId === bookingId));
    const historical = await pool.query<{ operation: string; status: string }>(
      "select operation,status from external_mwl_outbox where id=$1",
      [jobA.id]
    );
    assert.deepEqual(historical.rows[0], { operation: "upsert", status: "failed" });
    const stillCurrent = await pool.query<{ sync_status: string; deleted_at: string | null }>(
      "select sync_status,deleted_at::text as deleted_at from external_mwl_sync where booking_id=$1 and external_system='orthanc'",
      [bookingId]
    );
    assert.equal(stillCurrent.rows[0]!.sync_status, "synced");
    assert.equal(stillCurrent.rows[0]!.deleted_at, null);

    const withdrawal = await enqueueOrthancSyncForBooking(bookingId);
    assert.equal(withdrawal.operation, "delete");
    assert.notEqual(withdrawal.jobId, jobA.id);
    assert.notEqual(withdrawal.jobId, jobB.id);
    const deleteJob = await claimOrthancJob(bookingId, "delete");
    assert.equal(deleteJob.id, withdrawal.jobId);
    await markOrthancOutboxSuccess(deleteJob.id, bookingId, "delete", `current-${bookingId}`);
    const finalSync = await pool.query<{ sync_status: string; deleted_at: string | null }>(
      "select sync_status,deleted_at::text as deleted_at from external_mwl_sync where booking_id=$1 and external_system='orthanc'",
      [bookingId]
    );
    assert.equal(finalSync.rows[0]!.sync_status, "deleted");
    assert.ok(finalSync.rows[0]!.deleted_at);
  });

  it("preserves a DELETE successor when an in-flight Orthanc UPSERT succeeds or fails", async () => {
    await setSetting(MWL_POLICY_CATEGORY, REQUIRE_PROTOCOL_BEFORE_MWL_KEY, "disabled");

    for (const outcome of ["success", "failure"] as const) {
      const bookingId = await createBooking("ct", "arrived");
      const queued = await enqueueOrthancSyncForBooking(bookingId);
      const inFlight = await claimOrthancJob(bookingId, "upsert");
      assert.equal(inFlight.id, queued.jobId);

      await setSetting(MWL_POLICY_CATEGORY, REQUIRE_PROTOCOL_BEFORE_MWL_KEY, "enabled");
      const withdrawal = await enqueueOrthancSyncForBooking(bookingId);
      assert.equal(withdrawal.operation, "delete");
      assert.notEqual(withdrawal.jobId, inFlight.id);

      const rowsBefore = await pool.query<{ id: number; operation: string; status: string }>(
        "select id,operation,status from external_mwl_outbox where booking_id=$1 order by id",
        [bookingId]
      );
      assert.deepEqual(rowsBefore.rows.map((row) => [Number(row.id), row.operation, row.status]), [
        [inFlight.id, "upsert", "processing"],
        [withdrawal.jobId, "delete", "pending"],
      ]);
      assert.ok(!(await claimOrthancOutboxBatch(500)).some((job) => job.id === withdrawal.jobId));

      if (outcome === "success") {
        await markOrthancOutboxSuccess(inFlight.id, bookingId, "upsert", `old-${bookingId}`);
      } else {
        await markOrthancOutboxFailure(inFlight.id, bookingId, "obsolete upsert failed", 1);
      }

      const desiredBeforeDelete = await pool.query<{ sync_status: string; deleted_at: string | null }>(
        "select sync_status,deleted_at::text as deleted_at from external_mwl_sync where booking_id=$1 and external_system='orthanc'",
        [bookingId]
      );
      assert.equal(desiredBeforeDelete.rows[0]!.sync_status, "pending");
      assert.ok(desiredBeforeDelete.rows[0]!.deleted_at);

      const deleteJob = await claimOrthancJob(bookingId, "delete");
      assert.equal(deleteJob.id, withdrawal.jobId);
      await markOrthancOutboxSuccess(deleteJob.id, bookingId, "delete", `old-${bookingId}`);
      const finalSync = await pool.query<{ sync_status: string; deleted_at: string | null }>(
        "select sync_status,deleted_at::text as deleted_at from external_mwl_sync where booking_id=$1 and external_system='orthanc'",
        [bookingId]
      );
      assert.equal(finalSync.rows[0]!.sync_status, "deleted");
      assert.ok(finalSync.rows[0]!.deleted_at);
      await setSetting(MWL_POLICY_CATEGORY, REQUIRE_PROTOCOL_BEFORE_MWL_KEY, "disabled");
    }
  });

  it("preserves a Sante CA successor when an in-flight publication succeeds or fails", async () => {
    await setSetting(MWL_POLICY_CATEGORY, REQUIRE_PROTOCOL_BEFORE_MWL_KEY, "disabled");

    for (const outcome of ["success", "failure"] as const) {
      const bookingId = await createBooking("ct", "arrived");
      const queued = await enqueueSanteHl7ForBooking(bookingId);
      const inFlight = await claimSanteJob(bookingId, "create");
      assert.equal(inFlight.id, queued.jobId);

      await setSetting(MWL_POLICY_CATEGORY, REQUIRE_PROTOCOL_BEFORE_MWL_KEY, "enabled");
      const withdrawal = await enqueueSanteHl7ForBooking(bookingId);
      assert.equal(withdrawal.enqueued, true);
      assert.notEqual(withdrawal.jobId, inFlight.id);

      const rowsBefore = await pool.query<{ id: number; event_type: string; order_control: string; status: string }>(
        "select id,event_type,order_control,status from sante_hl7_outbox where booking_id=$1 order by id",
        [bookingId]
      );
      assert.deepEqual(rowsBefore.rows.map((row) => [Number(row.id), row.event_type, row.order_control, row.status]), [
        [inFlight.id, "create", "NW", "writing"],
        [withdrawal.jobId, "cancel", "CA", "pending"],
      ]);
      assert.ok(!(await claimSanteOutboxBatch(500)).some((job) => job.id === withdrawal.jobId));

      if (outcome === "success") {
        await writeSanteOutboxJob(inFlight);
      } else {
        await markSanteOutboxFailure(inFlight, "obsolete publication failed", true);
      }
      const oldStatus = await pool.query<{ status: string }>("select status from sante_hl7_outbox where id=$1", [inFlight.id]);
      assert.equal(oldStatus.rows[0]!.status, outcome === "success" ? "pending_import" : "skipped");

      const authoritative = await pool.query<{ last_outbox_id: number; sync_status: string; deleted_at: string | null }>(
        "select last_outbox_id,sync_status,deleted_at::text as deleted_at from sante_worklist_sync where booking_id=$1",
        [bookingId]
      );
      assert.equal(Number(authoritative.rows[0]!.last_outbox_id), withdrawal.jobId);
      assert.equal(authoritative.rows[0]!.sync_status, "pending");
      assert.ok(authoritative.rows[0]!.deleted_at);

      const cancelJob = await claimSanteJob(bookingId, "cancel");
      assert.equal(cancelJob.id, withdrawal.jobId);
      await writeSanteOutboxJob(cancelJob);
      const finalSync = await pool.query<{ last_outbox_id: number; sync_status: string; deleted_at: string | null }>(
        "select last_outbox_id,sync_status,deleted_at::text as deleted_at from sante_worklist_sync where booking_id=$1",
        [bookingId]
      );
      assert.equal(Number(finalSync.rows[0]!.last_outbox_id), cancelJob.id);
      assert.equal(finalSync.rows[0]!.sync_status, "written");
      assert.ok(finalSync.rows[0]!.deleted_at);
      await setSetting(MWL_POLICY_CATEGORY, REQUIRE_PROTOCOL_BEFORE_MWL_KEY, "disabled");
    }
  });

  it("uses and retries only the authoritative Sante outbox job", async () => {
    await setSetting(MWL_POLICY_CATEGORY, REQUIRE_PROTOCOL_BEFORE_MWL_KEY, "disabled");
    const bookingId = await createBooking("ct", "arrived");
    const queuedA = await enqueueSanteHl7ForBooking(bookingId);
    assert.equal(queuedA.enqueued, true);

    await setSetting(MWL_POLICY_CATEGORY, REQUIRE_PROTOCOL_BEFORE_MWL_KEY, "enabled");
    const queuedB = await enqueueSanteHl7ForBooking(bookingId);
    assert.equal(queuedB.enqueued, true);
    assert.notEqual(queuedB.jobId, queuedA.jobId);
    const jobB = await claimSanteJob(bookingId, "cancel");
    assert.equal(jobB.id, queuedB.jobId);
    await writeSanteOutboxJob(jobB);
    await pool.query("update sante_hl7_outbox set updated_at=now() + interval '1 day' where id=$1", [queuedA.jobId]);

    const monitor = await getWorklistMonitorEntries({
      dateFrom: TEST_DATE,
      dateTo: TEST_DATE,
      q: String(bookingId),
      limit: 10,
    });
    const monitorEntry = monitor.entries.find((entry) => entry.bookingId === bookingId);
    assert.equal(monitorEntry?.sante.outboxId, queuedB.jobId);
    assert.ok(Array.isArray(monitorEntry?.sante.history));
    assert.ok((monitorEntry?.sante.history as Array<{ id: number }>).some((row) => Number(row.id) === queuedA.jobId));
    assert.ok((monitorEntry?.sante.history as Array<{ id: number }>).some((row) => Number(row.id) === queuedB.jobId));

    await assert.rejects(
      retrySanteOutbox(queuedA.jobId!, fixture!.userId),
      (error: unknown) => {
        assert.equal((error as { statusCode?: number }).statusCode, 409);
        assert.match((error as Error).message, /superseded by a newer job/i);
        return true;
      }
    );
    const superseded = await pool.query<{ status: string }>("select status from sante_hl7_outbox where id=$1", [queuedA.jobId]);
    assert.equal(superseded.rows[0]!.status, "skipped");
    const authoritative = await pool.query<{ last_outbox_id: number }>(
      "select last_outbox_id from sante_worklist_sync where booking_id=$1",
      [bookingId]
    );
    assert.equal(Number(authoritative.rows[0]!.last_outbox_id), queuedB.jobId);
    const currentB = await pool.query<{ status: string }>("select status from sante_hl7_outbox where id=$1", [queuedB.jobId]);
    assert.equal(currentB.rows[0]!.status, "pending_import");
    await assert.rejects(
      retrySanteOutbox(queuedB.jobId!, fixture!.userId),
      (error: unknown) => {
        assert.equal((error as { statusCode?: number }).statusCode, 409);
        assert.match((error as Error).message, /not in a retryable failed state/i);
        return true;
      }
    );
    const successfulB = await pool.query<{ status: string }>("select status from sante_hl7_outbox where id=$1", [queuedB.jobId]);
    assert.equal(successfulB.rows[0]!.status, "pending_import");

    await setSetting(MWL_POLICY_CATEGORY, REQUIRE_PROTOCOL_BEFORE_MWL_KEY, "disabled");
    const retryableBookingId = await createBooking("ct", "arrived");
    const retryableQueued = await enqueueSanteHl7ForBooking(retryableBookingId);
    const retryableJob = await claimSanteJob(retryableBookingId, "create");
    assert.equal(retryableJob.id, retryableQueued.jobId);
    await markSanteOutboxFailure(retryableJob, "genuine delivery failure", false);
    await retrySanteOutbox(retryableJob.id, fixture!.userId);
    const retried = await pool.query<{ status: string }>("select status from sante_hl7_outbox where id=$1", [retryableJob.id]);
    assert.equal(retried.rows[0]!.status, "retry_scheduled");
    const retryAuthority = await pool.query<{ last_outbox_id: number }>(
      "select last_outbox_id from sante_worklist_sync where booking_id=$1",
      [retryableBookingId]
    );
    assert.equal(Number(retryAuthority.rows[0]!.last_outbox_id), retryableJob.id);
  });

  it("does not let withdrawn history bypass queue-only when protocol eligibility returns", async () => {
    await setSetting(MWL_POLICY_CATEGORY, REQUIRE_PROTOCOL_BEFORE_MWL_KEY, "disabled");
    await setSetting("orthanc_mwl_sync", "send_only_when_patient_enters_queue", "false");
    await setSetting("sante_worklist_hl7", "send_only_when_patient_enters_queue", "false");
    const bookingId = await createBooking("ct", "scheduled");
    await establishPublishedProjection(bookingId);

    await setSetting("orthanc_mwl_sync", "send_only_when_patient_enters_queue", "true");
    await setSetting("sante_worklist_hl7", "send_only_when_patient_enters_queue", "true");
    assert.equal((await enqueueOrthancSyncForBooking(bookingId)).operation, "upsert");
    assert.equal((await enqueueSanteHl7ForBooking(bookingId)).enqueued, true);
    assert.equal(await latestSanteEvent(bookingId), "update");
    await setSetting("orthanc_mwl_sync", "send_only_when_patient_enters_queue", "false");
    await setSetting("sante_worklist_hl7", "send_only_when_patient_enters_queue", "false");

    await setSetting(MWL_POLICY_CATEGORY, REQUIRE_PROTOCOL_BEFORE_MWL_KEY, "enabled");
    assert.equal((await enqueueOrthancSyncForBooking(bookingId)).operation, "delete");
    assert.equal((await enqueueSanteHl7ForBooking(bookingId)).reason, "waiting_for_protocol");
    await completeWithdrawal(bookingId);

    await setSetting("orthanc_mwl_sync", "send_only_when_patient_enters_queue", "true");
    await setSetting("sante_worklist_hl7", "send_only_when_patient_enters_queue", "true");
    await addFreeTextAssignment(bookingId);
    assert.equal((await enqueueOrthancSyncForBooking(bookingId)).reason, "waiting_for_patient_queue");
    assert.equal((await enqueueSanteHl7ForBooking(bookingId)).reason, "waiting_for_patient_queue");

    await pool.query("update appointments_v2.bookings set status='arrived' where id=$1", [bookingId]);
    assert.equal((await enqueueOrthancSyncForBooking(bookingId)).operation, "upsert");
    assert.equal((await enqueueSanteHl7ForBooking(bookingId)).enqueued, true);

    await setSetting("orthanc_mwl_sync", "send_only_when_patient_enters_queue", "false");
    await setSetting("sante_worklist_hl7", "send_only_when_patient_enters_queue", "false");
  });

  it("does not let withdrawn history bypass queue-only when the protocol gate is disabled", async () => {
    await setSetting(MWL_POLICY_CATEGORY, REQUIRE_PROTOCOL_BEFORE_MWL_KEY, "disabled");
    await setSetting("orthanc_mwl_sync", "send_only_when_patient_enters_queue", "false");
    await setSetting("sante_worklist_hl7", "send_only_when_patient_enters_queue", "false");
    const bookingId = await createBooking("ct", "scheduled");
    await establishPublishedProjection(bookingId);

    await setSetting(MWL_POLICY_CATEGORY, REQUIRE_PROTOCOL_BEFORE_MWL_KEY, "enabled");
    await enqueueOrthancSyncForBooking(bookingId);
    await enqueueSanteHl7ForBooking(bookingId);
    await completeWithdrawal(bookingId);
    await setSetting("orthanc_mwl_sync", "send_only_when_patient_enters_queue", "true");
    await setSetting("sante_worklist_hl7", "send_only_when_patient_enters_queue", "true");

    await setSetting(MWL_POLICY_CATEGORY, REQUIRE_PROTOCOL_BEFORE_MWL_KEY, "disabled");
    await reconcileMwlProtocolPolicyChange();
    assert.equal(await latestOrthancOperation(bookingId), "delete");
    assert.equal(await latestSanteEvent(bookingId), "cancel");
    assert.equal((await enqueueOrthancSyncForBooking(bookingId)).reason, "waiting_for_patient_queue");
    assert.equal((await enqueueSanteHl7ForBooking(bookingId)).reason, "waiting_for_patient_queue");

    await pool.query("update appointments_v2.bookings set status='waiting' where id=$1", [bookingId]);
    assert.equal((await enqueueOrthancSyncForBooking(bookingId)).operation, "upsert");
    assert.equal((await enqueueSanteHl7ForBooking(bookingId)).enqueued, true);
    await setSetting("orthanc_mwl_sync", "send_only_when_patient_enters_queue", "false");
    await setSetting("sante_worklist_hl7", "send_only_when_patient_enters_queue", "false");
  });

  it("setting transitions reconcile only affected CT/MRI bookings", async () => {
    await setSetting(MWL_POLICY_CATEGORY, REQUIRE_PROTOCOL_BEFORE_MWL_KEY, "disabled");
    const ct = await createBooking("ct", "arrived");
    const mammo = await createBooking("mammo", "arrived");
    await enqueueOrthancSyncForBooking(ct);
    await enqueueSanteHl7ForBooking(ct);
    await enqueueOrthancSyncForBooking(mammo);
    await enqueueSanteHl7ForBooking(mammo);
    const mammoOrthancBefore = await latestOrthancOperation(mammo);
    const mammoSanteBefore = await latestSanteEvent(mammo);

    await setSetting(MWL_POLICY_CATEGORY, REQUIRE_PROTOCOL_BEFORE_MWL_KEY, "enabled");
    const enabledAffected = await reconcileMwlProtocolPolicyChange();
    assert.ok(enabledAffected.includes(ct));
    assert.ok(!enabledAffected.includes(mammo));
    await waitFor(async () => (await latestOrthancOperation(ct)) === "delete" ? "delete" : null, "setting enable Orthanc withdrawal");
    await waitFor(async () => (await latestSanteEvent(ct)) === "cancel" ? "cancel" : null, "setting enable Sante withdrawal");
    assert.equal(await latestOrthancOperation(mammo), mammoOrthancBefore);
    assert.equal(await latestSanteEvent(mammo), mammoSanteBefore);

    await setSetting(MWL_POLICY_CATEGORY, REQUIRE_PROTOCOL_BEFORE_MWL_KEY, "disabled");
    await reconcileMwlProtocolPolicyChange();
    await waitFor(async () => (await latestOrthancOperation(ct)) === "upsert" ? "upsert" : null, "setting disable Orthanc republish");
    await waitFor(async () => ["create", "update"].includes(await latestSanteEvent(ct) ?? "") ? "published" : null, "setting disable Sante republish");
  });

  it("setting disable re-evaluation still respects both external queue-only gates", async () => {
    await setSetting(MWL_POLICY_CATEGORY, REQUIRE_PROTOCOL_BEFORE_MWL_KEY, "enabled");
    await setSetting("orthanc_mwl_sync", "send_only_when_patient_enters_queue", "true");
    await setSetting("sante_worklist_hl7", "send_only_when_patient_enters_queue", "true");
    const bookingId = await createBooking("ct", "scheduled");
    await clearSync(bookingId);
    assert.equal((await enqueueOrthancSyncForBooking(bookingId)).reason, "waiting_for_protocol");
    assert.equal((await enqueueSanteHl7ForBooking(bookingId)).reason, "waiting_for_protocol");
    await setSetting(MWL_POLICY_CATEGORY, REQUIRE_PROTOCOL_BEFORE_MWL_KEY, "disabled");
    await reconcileMwlProtocolPolicyChange();
    assert.equal(await latestOrthancOperation(bookingId), null);
    assert.equal(await latestSanteEvent(bookingId), null);
    await setSetting("orthanc_mwl_sync", "send_only_when_patient_enters_queue", "false");
    await setSetting("sante_worklist_hl7", "send_only_when_patient_enters_queue", "false");
  });

  it("settings route preserves supervisor re-auth and triggers durable reconciliation", async () => {
    await setSetting(MWL_POLICY_CATEGORY, REQUIRE_PROTOCOL_BEFORE_MWL_KEY, "disabled");
    const bookingId = await createBooking("ct", "arrived");
    await enqueueOrthancSyncForBooking(bookingId);
    await enqueueSanteHl7ForBooking(bookingId);
    const authCookie = createTestAuthCookie(fixture!.userId);
    const denied = await fetchJson(testApp!.baseUrl, `/api/settings/${MWL_POLICY_CATEGORY}`, {
      method: "PUT",
      cookie: authCookie,
      body: { entries: [{ key: REQUIRE_PROTOCOL_BEFORE_MWL_KEY, value: { value: "enabled" } }] },
    });
    assert.equal(denied.status, 403);

    const saved = await fetchJson(testApp!.baseUrl, `/api/settings/${MWL_POLICY_CATEGORY}`, {
      method: "PUT",
      cookie: `${authCookie}; ${createTestSupervisorReauthCookie(fixture!.userId)}`,
      body: { entries: [{ key: REQUIRE_PROTOCOL_BEFORE_MWL_KEY, value: { value: "enabled" } }] },
    });
    assert.equal(saved.status, 200);
    await waitFor(async () => (await latestOrthancOperation(bookingId)) === "delete" ? "delete" : null, "settings-route Orthanc withdrawal");
    await waitFor(async () => (await latestSanteEvent(bookingId)) === "cancel" ? "cancel" : null, "settings-route Sante withdrawal");
  });
});

async function clearSyncForBookings(bookingIds: number[]): Promise<void> {
  if (bookingIds.length === 0) return;
  await pool.query("delete from external_mwl_outbox where booking_id=any($1::bigint[])", [bookingIds]);
  await pool.query("delete from external_mwl_sync where booking_id=any($1::bigint[])", [bookingIds]);
  await pool.query("delete from sante_hl7_outbox where booking_id=any($1::bigint[])", [bookingIds]);
  await pool.query("delete from sante_worklist_sync where booking_id=any($1::bigint[])", [bookingIds]);
}
