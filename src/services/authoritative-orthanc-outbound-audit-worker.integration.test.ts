import test from "node:test";
import assert from "node:assert/strict";
import type { OrthancTransferredStudySummary } from "./authoritative-orthanc-service.js";

process.env.DATABASE_URL ||= "postgresql://127.0.0.1/rispro_test";
process.env.JWT_SECRET ||= "test-secret";

const [{ pool }, worker, { listDicomTransferHistory }] = await Promise.all([
  import("../db/pool.js"),
  import("./authoritative-orthanc-outbound-audit-worker.js"),
  import("./dicom-transfer-event-service.js"),
]);

test("Authoritative Orthanc outbound audit is durable, baseline-safe, and idempotent", async (t) => {
  const token = Date.now().toString(36);
  const prefix = `outbound-audit-${token}`;
  const studyUid = `2.25.${Date.now()}.${token}`;
  const secondStudyUid = `${studyUid}.2`;
  const activationMs = Date.now();
  const oldCreationTime = compact(new Date(activationMs - 60_000));
  const newCreationTime = compact(new Date(activationMs + 1_000));
  const completionTime = compact(new Date(activationMs + 42_000));
  const study = (uid = studyUid, resourceId = `${prefix}-study`): OrthancTransferredStudySummary => ({
    orthancStudyId: resourceId,
    studyInstanceUid: uid,
    patientId: uid === studyUid ? "PATIENT-1" : "PATIENT-2",
    patientName: uid === studyUid ? "Patient One" : "Patient Two",
    accessionNumber: uid === studyUid ? "ACC-1" : "ACC-2",
    studyDate: "20260903",
    studyDescription: uid === studyUid ? "CT chest" : "MR brain",
    modalitiesInStudy: uid === studyUid ? ["CT"] : ["MR"],
  });

  const makeJob = (id: string, overrides: { type?: string; state?: string; creationTime?: string; completionTime?: string | null; content?: Record<string, unknown>; errorCode?: unknown; errorDescription?: unknown; errorDetails?: unknown } = {}) => ({
    ID: `${prefix}-${id}`,
    Type: overrides.type ?? "DicomModalityStore",
    State: overrides.state ?? "Success",
    CreationTime: overrides.creationTime ?? newCreationTime,
    CompletionTime: overrides.completionTime === undefined ? completionTime : overrides.completionTime,
    Timestamp: "19990101T000000.999999",
    ErrorCode: overrides.errorCode ?? 0,
    ErrorDescription: overrides.errorDescription ?? "Success",
    ErrorDetails: overrides.errorDetails ?? "",
    Content: {
      LocalAet: "ORTHANCPG",
      RemoteAet: "PACS1",
      InstancesCount: 903,
      FailedInstancesCount: 0,
      ParentResources: [`${prefix}-resource-1`],
      ...(overrides.content ?? {}),
    },
  });

  const makeClient = (jobs: unknown[], summaries: Record<string, OrthancTransferredStudySummary | null>, options: { queryError?: Error } = {}) => async () => ({
    async listJobs() {
      if (options.queryError) throw options.queryError;
      return jobs;
    },
    async getStudySummaryForTransferredResource(resourceId: string) {
      return summaries[resourceId] ?? null;
    },
  });

  const event = async (jobId: string, uid = studyUid) => (await pool.query<{
    id: string;
    direction: string;
    status: string;
    patient_id: string | null;
    patient_name: string | null;
    accession_number: string | null;
    study_instance_uid: string;
    source_aet: string | null;
    source_ip: string | null;
    destination_aet: string | null;
    instance_count: number | null;
    first_seen_at: string;
    last_seen_at: string;
    completed_at: string | null;
    error_code: string | null;
    error_message: string | null;
    orthanc_resource_id: string | null;
  }>(
    `select id::text,direction,status,patient_id,patient_name,accession_number,study_instance_uid,source_aet,source_ip,destination_aet,instance_count,
       first_seen_at::text,last_seen_at::text,completed_at::text,error_code,error_message,orthanc_resource_id
       from dicom_transfer_events where direction='SENT' and orthanc_job_id=$1 and study_instance_uid=$2`,
    [jobId, uid],
  )).rows[0] ?? null;

  async function resetState(): Promise<void> {
    await pool.query("delete from authoritative_orthanc_outbound_audit_state");
  }

  try {
    await pool.query("delete from dicom_transfer_events where orthanc_job_id like $1", [`${prefix}%`]);
    await resetState();

    await t.test("first cycle initializes without historical backfill", async () => {
      let factoryCalled = false;
      const result = await worker.runAuthoritativeOrthancOutboundAuditCycle(async () => {
        factoryCalled = true;
        return makeClient([makeJob("historical", { creationTime: oldCreationTime })], {})();
      });
      assert.deepEqual(result, { lockAcquired: true, mode: "initialized", recorded: 0 });
      assert.equal(factoryCalled, false);
      assert.equal((await pool.query("select 1 from dicom_transfer_events where orthanc_job_id like $1", [`${prefix}%`])).rowCount, 0);
      assert.equal((await pool.query("select 1 from authoritative_orthanc_outbound_audit_state where singleton_key=true")).rowCount, 1);
    });

    await t.test("jobs predating the baseline remain excluded", async () => {
      const result = await worker.runAuthoritativeOrthancOutboundAuditCycle(makeClient([makeJob("historical", { creationTime: oldCreationTime })], {}));
      assert.deepEqual(result, { lockAcquired: true, mode: "processed", recorded: 0 });
      assert.equal(await event(`${prefix}-historical`), null);
    });

    await t.test("new successful jobs create SENT history with Orthanc creation/completion times", async () => {
      const result = await worker.runAuthoritativeOrthancOutboundAuditCycle(makeClient([makeJob("success")], { [`${prefix}-resource-1`]: study() }));
      assert.deepEqual(result, { lockAcquired: true, mode: "processed", recorded: 1 });
      const row = await event(`${prefix}-success`);
      assert.ok(row);
      assert.equal(row!.direction, "SENT");
      assert.equal(row!.status, "SUCCESS");
      assert.equal(dbIso(row!.first_seen_at), iso(newCreationTime));
      assert.equal(dbIso(row!.completed_at), iso(completionTime));
      assert.equal(dbIso(row!.last_seen_at), iso(completionTime));
      assert.equal(row!.source_aet, "ORTHANCPG");
      assert.equal(row!.destination_aet, "PACS1");
      assert.equal(row!.source_ip, null);
      assert.equal(row!.instance_count, 903);
      assert.equal(row!.orthanc_resource_id, `${prefix}-study`);
      const history = await listDicomTransferHistory({ direction: "sent", search: studyUid });
      assert.equal(history.total, 1);
      assert.equal(history.items[0]?.orthancJobId, `${prefix}-success`);
    });

    await t.test("running then successful observation updates one durable row and ignores Timestamp", async () => {
      const jobId = `${prefix}-transition`;
      const running = makeJob("transition", { state: "Running", completionTime: null });
      const activeResult = await worker.runAuthoritativeOrthancOutboundAuditCycle(makeClient([running], { [`${prefix}-resource-1`]: study() }));
      assert.equal(activeResult.recorded, 1);
      const active = await event(jobId);
      assert.ok(active);
      assert.equal(active!.status, "ACTIVE");
      assert.equal(active!.completed_at, null);
      assert.ok(new Date(active!.last_seen_at).getTime() > 0);
      const success = await worker.runAuthoritativeOrthancOutboundAuditCycle(makeClient([makeJob("transition")], { [`${prefix}-resource-1`]: study() }));
      assert.equal(success.recorded, 1);
      const completed = await event(jobId);
      assert.equal(completed!.id, active!.id);
      assert.equal(completed!.status, "SUCCESS");
      assert.equal(dbIso(completed!.first_seen_at), iso(newCreationTime));
      assert.equal(dbIso(completed!.completed_at), iso(completionTime));
      assert.notEqual(dbIso(completed!.completed_at), iso("19990101T000000.999999"));
    });

    await t.test("failure records bounded diagnostics and a later active resubmission clears them", async () => {
      const failed = await worker.runAuthoritativeOrthancOutboundAuditCycle(makeClient([makeJob("failure", { state: "Failure", errorCode: 27, errorDescription: "Connection failed", errorDetails: "Authorization: Bearer secret" })], { [`${prefix}-resource-1`]: study() }));
      assert.equal(failed.recorded, 1);
      const failedRow = await event(`${prefix}-failure`);
      assert.equal(failedRow!.status, "FAILED");
      assert.equal(failedRow!.error_code, "27");
      assert.match(failedRow!.error_message || "", /Connection failed/);
      assert.doesNotMatch(failedRow!.error_message || "", /secret/);
      const resumed = await worker.runAuthoritativeOrthancOutboundAuditCycle(makeClient([makeJob("failure", { state: "Retry", completionTime: null })], { [`${prefix}-resource-1`]: study() }));
      assert.equal(resumed.recorded, 1);
      const active = await event(`${prefix}-failure`);
      assert.equal(active!.status, "ACTIVE");
      assert.equal(active!.completed_at, null);
      assert.equal(active!.error_code, null);
      assert.equal(active!.error_message, null);
    });

    await t.test("non-store jobs are ignored and missing creation times are skipped", async () => {
      const result = await worker.runAuthoritativeOrthancOutboundAuditCycle(makeClient([
        makeJob("ignored", { type: "Archive" }),
        makeJob("invalid-time", { creationTime: "not-a-time" }),
      ], { [`${prefix}-resource-1`]: study() }));
      assert.equal(result.recorded, 0);
      assert.equal(await event(`${prefix}-ignored`), null);
      assert.equal(await event(`${prefix}-invalid-time`), null);
    });

    await t.test("same-study resources deduplicate, distinct studies get separate rows without duplicated counts", async () => {
      const same = makeJob("same-study", { content: { ParentResources: [`${prefix}-resource-1`, `${prefix}-resource-2`] } });
      const sameResult = await worker.runAuthoritativeOrthancOutboundAuditCycle(makeClient([same], { [`${prefix}-resource-1`]: study(), [`${prefix}-resource-2`]: study(undefined, `${prefix}-study-alias`) }));
      assert.equal(sameResult.recorded, 1);
      assert.equal((await pool.query("select 1 from dicom_transfer_events where orthanc_job_id=$1", [`${prefix}-same-study`])).rowCount, 1);
      assert.equal((await event(`${prefix}-same-study`))!.instance_count, 903);

      const distinct = makeJob("distinct-study", { content: { ParentResources: [`${prefix}-resource-1`, `${prefix}-resource-3`] } });
      const distinctResult = await worker.runAuthoritativeOrthancOutboundAuditCycle(makeClient([distinct], { [`${prefix}-resource-1`]: study(), [`${prefix}-resource-3`]: study(secondStudyUid, `${prefix}-study-2`) }));
      assert.equal(distinctResult.recorded, 2);
      const rows = await pool.query<{ study_instance_uid: string; instance_count: number | null }>("select study_instance_uid,instance_count from dicom_transfer_events where orthanc_job_id=$1 order by study_instance_uid", [`${prefix}-distinct-study`]);
      assert.deepEqual(rows.rows, [{ study_instance_uid: studyUid, instance_count: null }, { study_instance_uid: secondStudyUid, instance_count: null }]);
    });

    await t.test("partial study resolution keeps the safely resolved row count null and retries to a full count", async () => {
      const job = makeJob("partial", { content: { ParentResources: [`${prefix}-resource-1`, `${prefix}-resource-missing`] } });
      const partialResult = await worker.runAuthoritativeOrthancOutboundAuditCycle(makeClient([job], { [`${prefix}-resource-1`]: study() }));
      assert.equal(partialResult.recorded, 1);
      assert.equal((await event(`${prefix}-partial`))!.instance_count, null);

      const retry = makeJob("partial", { content: { ParentResources: [`${prefix}-resource-1`, `${prefix}-resource-2`] } });
      const retryResult = await worker.runAuthoritativeOrthancOutboundAuditCycle(makeClient([retry], { [`${prefix}-resource-1`]: study(), [`${prefix}-resource-2`]: study(undefined, `${prefix}-study-alias`) }));
      assert.equal(retryResult.recorded, 1);
      assert.equal((await pool.query("select 1 from dicom_transfer_events where orthanc_job_id=$1", [`${prefix}-partial`])).rowCount, 1);
      assert.equal((await event(`${prefix}-partial`))!.instance_count, 903);
    });

    await t.test("unresolved resources do not abort an unrelated valid job and Resources is a fallback", async () => {
      const fallback = makeJob("fallback", { content: { ParentResources: [], Resources: [{ ID: `${prefix}-resource-1`, Type: "Study" }] } });
      const result = await worker.runAuthoritativeOrthancOutboundAuditCycle(makeClient([
        makeJob("unresolved", { content: { ParentResources: [`${prefix}-missing`] } }),
        fallback,
      ], { [`${prefix}-resource-1`]: study() }));
      assert.equal(result.recorded, 1);
      assert.equal(await event(`${prefix}-unresolved`), null);
      assert.ok(await event(`${prefix}-fallback`));
    });

    await t.test("repeated polling remains idempotent", async () => {
      const jobs = [makeJob("repeated")];
      const summaries = { [`${prefix}-resource-1`]: study() };
      await worker.runAuthoritativeOrthancOutboundAuditCycle(makeClient(jobs, summaries));
      await worker.runAuthoritativeOrthancOutboundAuditCycle(makeClient(jobs, summaries));
      assert.equal((await pool.query("select 1 from dicom_transfer_events where orthanc_job_id=$1", [`${prefix}-repeated`])).rowCount, 1);
    });

    await t.test("fractional baseline comparison retains the millisecond", async () => {
      await resetState();
      const baseline = new Date(Date.now() + 60_000);
      await pool.query("insert into authoritative_orthanc_outbound_audit_state(singleton_key,initialized_at) values(true,$1)", [baseline]);
      const fractional = compact(baseline, 1);
      const result = await worker.runAuthoritativeOrthancOutboundAuditCycle(makeClient([makeJob("fractional", { creationTime: fractional })], { [`${prefix}-resource-1`]: study() }));
      assert.equal(result.recorded, 1);
      assert.equal(dbIso((await event(`${prefix}-fractional`))!.first_seen_at), iso(fractional));
    });

    await t.test("the dedicated advisory lock prevents concurrent cycles", async () => {
      const lock = await pool.connect();
      try {
        await lock.query("select pg_advisory_lock($1)", [worker.AUTHORITATIVE_ORTHANC_OUTBOUND_AUDIT_LOCK_KEY]);
        assert.deepEqual(await worker.runAuthoritativeOrthancOutboundAuditCycle(makeClient([], {})), { lockAcquired: false, mode: "processed", recorded: 0 });
      } finally {
        await lock.query("select pg_advisory_unlock($1)", [worker.AUTHORITATIVE_ORTHANC_OUTBOUND_AUDIT_LOCK_KEY]);
        lock.release();
      }
    });

    await t.test("overall Orthanc query failures set last_error and a later success clears it", async () => {
      await resetState();
      await pool.query("insert into authoritative_orthanc_outbound_audit_state(singleton_key,initialized_at) values(true,now())");
      const failure = await worker.runAuthoritativeOrthancOutboundAuditCycle(makeClient([], {}, { queryError: new Error("Orthanc unavailable password=secret") }));
      assert.deepEqual(failure, { lockAcquired: true, mode: "failed", recorded: 0 });
      const failedState = await pool.query<{ last_error: string | null }>("select last_error from authoritative_orthanc_outbound_audit_state where singleton_key=true");
      assert.match(failedState.rows[0]?.last_error || "", /Orthanc unavailable/);
      assert.doesNotMatch(failedState.rows[0]?.last_error || "", /secret/);
      const success = await worker.runAuthoritativeOrthancOutboundAuditCycle(makeClient([], {}));
      assert.deepEqual(success, { lockAcquired: true, mode: "processed", recorded: 0 });
      const recovered = await pool.query<{ last_error: string | null; last_success_at: string | null }>("select last_error,last_success_at from authoritative_orthanc_outbound_audit_state where singleton_key=true");
      assert.equal(recovered.rows[0]?.last_error, null);
      assert.ok(recovered.rows[0]?.last_success_at);
    });
  } finally {
    await pool.query("delete from dicom_transfer_events where orthanc_job_id like $1", [`${prefix}%`]);
    await resetState();
    await pool.end();
  }
});

function compact(date: Date, additionalMicroseconds = 0): string {
  const milliseconds = date.getUTCMilliseconds();
  const fraction = String(milliseconds * 1_000 + additionalMicroseconds).padStart(6, "0");
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}T${String(date.getUTCHours()).padStart(2, "0")}${String(date.getUTCMinutes()).padStart(2, "0")}${String(date.getUTCSeconds()).padStart(2, "0")}.${fraction}`;
}

function iso(value: string): string {
  const compactValue = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:\.(\d+))?$/);
  if (!compactValue) return new Date(value).toISOString();
  const milliseconds = Number((compactValue[7] || "").slice(0, 3).padEnd(3, "0"));
  return new Date(Date.UTC(Number(compactValue[1]), Number(compactValue[2]) - 1, Number(compactValue[3]), Number(compactValue[4]), Number(compactValue[5]), Number(compactValue[6]), milliseconds)).toISOString();
}

function dbIso(value: string | null): string | null {
  return value == null ? null : new Date(value).toISOString();
}
