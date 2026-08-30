import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ||= "postgresql://127.0.0.1/rispro_test";
process.env.JWT_SECRET ||= "test-secret";

test("Authoritative Orthanc inbound audit buffers raw NewInstance changes until each StableStudy", async (t) => {
  const [{ pool }, worker] = await Promise.all([import("../db/pool.js"), import("./authoritative-orthanc-inbound-audit-worker.js")]);
  const prefix = `audit-pending-${Date.now()}`;
  const studyId = `${prefix}-study`;
  const studyUid = `2.25.${Date.now()}${Math.floor(Math.random() * 1_000_000)}`;
  const state = async (sequence: number | null) => pool.query("update authoritative_orthanc_inbound_audit_state set last_change_sequence=$1,last_success_at=null,last_error=null,updated_at=now() where singleton_key=true", [sequence]);
  const newInstance = (sequence: number, id: string) => ({ sequence, changeType: "NewInstance", resourceType: "Instance", resourceId: id, date: "20260830T100000" });
  const stable = (sequence: number) => ({ sequence, changeType: "StableStudy", resourceType: "Study", resourceId: studyId, date: "20260830T100200" });
  type Change = ReturnType<typeof newInstance> | ReturnType<typeof stable>;
  type Metadata = { orthancInstanceId: string; origin: string | null; remoteAet: string | null; remoteIp: string | null; calledAet: string | null; receptionDate: string | null };
  const makeClient = (changes: Change[], instanceIds: string[], metadata: Metadata[], options: { metricsTail?: number | null; missingStudy?: boolean; metadataError?: boolean } = {}) => ({
    async getChanges(since: number) {
      const remaining = changes.filter((change) => change.sequence > since);
      return { changes: remaining, lastSequence: remaining.at(-1)?.sequence ?? since, done: true };
    },
    async getLastChangeSequenceFromMetrics() { return options.metricsTail ?? null; },
    async getStudyForInboundAudit() {
      if (options.metadataError) throw new Error("temporary Orthanc failure");
      if (options.missingStudy) return null;
      return { study: { orthancStudyId: studyId, patientId: "PAT-1", patientName: "Inbound^Patient", accessionNumber: "ACC-1", studyInstanceUid: studyUid, studyDescription: "CT chest", patientBirthDate: null, patientSex: null, studyDate: null, modalitiesInStudy: ["CT"], seriesCount: 1, instanceCount: instanceIds.length }, instanceIds };
    },
    async getInstanceReceptionMetadata(id: string) {
      if (options.metadataError) throw new Error("temporary Orthanc failure");
      return metadata.find((item) => item.orthancInstanceId === id) || null;
    },
  });
  const eventCount = async (sequence: number) => (await pool.query("select 1 from dicom_transfer_events where orthanc_resource_id=$1 and orthanc_change_sequence=$2", [studyId, sequence])).rowCount;

  try {
    await pool.query("delete from dicom_transfer_events where orthanc_resource_id=$1", [studyId]);
    await pool.query("delete from authoritative_orthanc_inbound_pending_instances where orthanc_instance_id like $1", [`${prefix}%`]);
    await state(null);

    await t.test("first run uses orthanc_last_change and does not backfill old StableStudy changes", async () => {
      let changesRead = false;
      const client = makeClient([stable(50)], [], [], { metricsTail: 50 });
      const result = await worker.runAuthoritativeOrthancInboundAuditCycle(async () => ({ ...client, async getChanges(since: number) { changesRead = true; return client.getChanges(since); } }));
      assert.deepEqual(result, { lockAcquired: true, mode: "initialized", recorded: 0, lastSequence: 50 });
      assert.equal(changesRead, false);
      assert.equal(await eventCount(50), 0);
    });

    await t.test("NewInstance rows persist idempotently before a StableStudy", async () => {
      const id = `${prefix}-retry`;
      await state(50);
      await worker.runAuthoritativeOrthancInboundAuditCycle(async () => makeClient([newInstance(51, id)], [], []));
      await state(50);
      await worker.runAuthoritativeOrthancInboundAuditCycle(async () => makeClient([newInstance(51, id)], [], []));
      assert.equal((await pool.query("select 1 from authoritative_orthanc_inbound_pending_instances where change_sequence=51 and orthanc_instance_id=$1", [id])).rowCount, 1);
    });

    await t.test("500 pending instances then StableStudy records 500, while a later 50-instance episode records only 50", async () => {
      const firstIds = Array.from({ length: 500 }, (_, index) => `${prefix}-first-${index}`);
      const firstChanges: Change[] = firstIds.map((id, index) => newInstance(100 + index, id));
      firstChanges.push(stable(600));
      const firstMetadata = firstIds.map((id) => ({ orthancInstanceId: id, origin: "DicomProtocol", remoteAet: "CT_AE", remoteIp: "10.0.0.10", calledAet: "ORTHANCPG", receptionDate: "20260830T100000" }));
      await state(51);
      const first = await worker.runAuthoritativeOrthancInboundAuditCycle(async () => makeClient(firstChanges, firstIds, firstMetadata));
      assert.equal(first.recorded, 1);
      assert.equal((await pool.query<{ instance_count: number }>("select instance_count from dicom_transfer_events where orthanc_resource_id=$1 and orthanc_change_sequence=600", [studyId])).rows[0]?.instance_count, 500);
      assert.equal((await pool.query("select 1 from authoritative_orthanc_inbound_pending_instances where orthanc_instance_id = any($1::text[])", [firstIds])).rowCount, 0);

      const laterIds = Array.from({ length: 50 }, (_, index) => `${prefix}-later-${index}`);
      const laterChanges: Change[] = laterIds.map((id, index) => newInstance(601 + index, id));
      laterChanges.push(stable(651));
      const laterMetadata = laterIds.map((id) => ({ orthancInstanceId: id, origin: "DicomProtocol", remoteAet: "CT_AE", remoteIp: "10.0.0.10", calledAet: "ORTHANCPG", receptionDate: "20260830T101000" }));
      const later = await worker.runAuthoritativeOrthancInboundAuditCycle(async () => makeClient(laterChanges, [...firstIds, ...laterIds], [...firstMetadata, ...laterMetadata]));
      assert.equal(later.recorded, 1);
      assert.equal((await pool.query<{ instance_count: number }>("select instance_count from dicom_transfer_events where orthanc_resource_id=$1 and orthanc_change_sequence=651", [studyId])).rows[0]?.instance_count, 50);
    });

    await t.test("pending instances with a sequence after StableStudy are excluded", async () => {
      const matched = `${prefix}-at-stable`;
      const after = `${prefix}-after-stable`;
      await pool.query("insert into authoritative_orthanc_inbound_pending_instances(change_sequence,orthanc_instance_id) values(700,$1),(701,$2)", [matched, after]);
      await state(699);
      const result = await worker.runAuthoritativeOrthancInboundAuditCycle(async () => makeClient([stable(700)], [matched, after], [
        { orthancInstanceId: matched, origin: "DicomProtocol", remoteAet: "MR_AE", remoteIp: "10.0.0.11", calledAet: "ORTHANCPG", receptionDate: "20260830T102000" },
        { orthancInstanceId: after, origin: "DicomProtocol", remoteAet: "MR_AE", remoteIp: "10.0.0.11", calledAet: "ORTHANCPG", receptionDate: "20260830T102001" },
      ]));
      assert.equal(result.recorded, 1);
      assert.equal((await pool.query<{ instance_count: number }>("select instance_count from dicom_transfer_events where orthanc_resource_id=$1 and orthanc_change_sequence=700", [studyId])).rows[0]?.instance_count, 1);
      assert.equal((await pool.query("select 1 from authoritative_orthanc_inbound_pending_instances where change_sequence=701")).rowCount, 1);
    });

    await t.test("source groups remain separate and non-DICOM origins create no audit row", async () => {
      const ids = ["group-a", "group-b", "rest", "lua", "plugin"].map((suffix) => `${prefix}-${suffix}`);
      const changes: Change[] = ids.map((id, index) => newInstance(710 + index, id));
      changes.push(stable(715));
      const result = await worker.runAuthoritativeOrthancInboundAuditCycle(async () => makeClient(changes, ids, [
        { orthancInstanceId: ids[0]!, origin: "DicomProtocol", remoteAet: "CT_AE", remoteIp: "10.0.0.10", calledAet: "ORTHANCPG", receptionDate: "20260830T103000" },
        { orthancInstanceId: ids[1]!, origin: "DicomProtocol", remoteAet: "MR_AE", remoteIp: "10.0.0.11", calledAet: "ARCHIVE_AE", receptionDate: "20260830T103001" },
        { orthancInstanceId: ids[2]!, origin: "RestApi", remoteAet: null, remoteIp: null, calledAet: null, receptionDate: null },
        { orthancInstanceId: ids[3]!, origin: "Lua", remoteAet: null, remoteIp: null, calledAet: null, receptionDate: null },
        { orthancInstanceId: ids[4]!, origin: "Plugins", remoteAet: null, remoteIp: null, calledAet: null, receptionDate: null },
      ]));
      assert.equal(result.recorded, 2);
      assert.deepEqual((await pool.query<{ source_aet: string; source_ip: string; destination_aet: string; instance_count: number }>("select source_aet,source_ip,destination_aet,instance_count from dicom_transfer_events where orthanc_resource_id=$1 and orthanc_change_sequence=715 order by source_aet", [studyId])).rows, [
        { source_aet: "CT_AE", source_ip: "10.0.0.10", destination_aet: "ORTHANCPG", instance_count: 1 },
        { source_aet: "MR_AE", source_ip: "10.0.0.11", destination_aet: "ARCHIVE_AE", instance_count: 1 },
      ]);
      assert.equal((await pool.query("select 1 from authoritative_orthanc_inbound_pending_instances where orthanc_instance_id = any($1::text[])", [ids])).rowCount, 0, "all successfully handled pending instances are consumed");
    });

    await t.test("missing studies and missing instances warn, consume what is known, and advance", async () => {
      const missingStudyInstance = `${prefix}-missing-study`;
      await state(715);
      const missingStudy = await worker.runAuthoritativeOrthancInboundAuditCycle(async () => makeClient([newInstance(716, missingStudyInstance), stable(717)], [], [], { missingStudy: true }));
      assert.deepEqual(missingStudy, { lockAcquired: true, mode: "processed", recorded: 0, lastSequence: 717 });
      const missingInstance = `${prefix}-missing-instance`;
      const missing = await worker.runAuthoritativeOrthancInboundAuditCycle(async () => makeClient([newInstance(718, missingInstance), stable(719)], [missingInstance], []));
      assert.deepEqual(missing, { lockAcquired: true, mode: "processed", recorded: 0, lastSequence: 719 });
      assert.equal((await pool.query("select 1 from authoritative_orthanc_inbound_pending_instances where orthanc_instance_id=$1", [missingInstance])).rowCount, 0);
    });

    await t.test("a transient Orthanc failure preserves both cursor and pending rows", async () => {
      const id = `${prefix}-transient`;
      await worker.runAuthoritativeOrthancInboundAuditCycle(async () => makeClient([newInstance(720, id)], [], []));
      const failed = await worker.runAuthoritativeOrthancInboundAuditCycle(async () => makeClient([stable(721)], [id], [], { metadataError: true }));
      assert.equal(failed.mode, "failed");
      assert.equal((await pool.query<{ last_change_sequence: string }>("select last_change_sequence::text from authoritative_orthanc_inbound_audit_state where singleton_key=true")).rows[0]?.last_change_sequence, "720");
      assert.equal((await pool.query("select 1 from authoritative_orthanc_inbound_pending_instances where orthanc_instance_id=$1", [id])).rowCount, 1);
    });

    await t.test("deduplicated StableStudy retries do not increment recorded", async () => {
      const id = `${prefix}-dedupe`;
      const changes: Change[] = [newInstance(730, id), stable(731)];
      const metadata = [{ orthancInstanceId: id, origin: "DicomProtocol", remoteAet: "US_AE", remoteIp: null, calledAet: "ORTHANCPG", receptionDate: "20260830T104000" }];
      await state(729);
      assert.equal((await worker.runAuthoritativeOrthancInboundAuditCycle(async () => makeClient(changes, [id], metadata))).recorded, 1);
      await state(729);
      assert.equal((await worker.runAuthoritativeOrthancInboundAuditCycle(async () => makeClient(changes, [id], metadata))).recorded, 0);
      assert.equal(await eventCount(731), 1);
    });

    await t.test("stale pending rows are cleaned without touching recent rows", async () => {
      const stale = `${prefix}-stale`;
      const recent = `${prefix}-recent`;
      await pool.query("insert into authoritative_orthanc_inbound_pending_instances(change_sequence,orthanc_instance_id,created_at) values(800,$1,now()-interval '8 days'),(801,$2,now())", [stale, recent]);
      await worker.runAuthoritativeOrthancInboundAuditCycle(async () => makeClient([], [], []));
      assert.equal((await pool.query("select 1 from authoritative_orthanc_inbound_pending_instances where orthanc_instance_id=$1", [stale])).rowCount, 0);
      assert.equal((await pool.query("select 1 from authoritative_orthanc_inbound_pending_instances where orthanc_instance_id=$1", [recent])).rowCount, 1);
    });

    await t.test("metrics-unavailable initialization safely falls back to sequential changes", async () => {
      await state(null);
      const result = await worker.runAuthoritativeOrthancInboundAuditCycle(async () => makeClient([stable(900)], [], [], { metricsTail: null }));
      assert.deepEqual(result, { lockAcquired: true, mode: "initialized", recorded: 0, lastSequence: 900 });
    });

    await t.test("advisory locking prevents concurrent consumption", async () => {
      const lock = await pool.connect();
      try {
        await lock.query("select pg_advisory_lock(712364093)");
        assert.deepEqual(await worker.runAuthoritativeOrthancInboundAuditCycle(async () => makeClient([], [], [])), { lockAcquired: false, mode: "processed", recorded: 0, lastSequence: null });
      } finally { await lock.query("select pg_advisory_unlock(712364093)"); lock.release(); }
    });
  } finally {
    await pool.query("delete from dicom_transfer_events where orthanc_resource_id=$1", [studyId]);
    await pool.query("delete from authoritative_orthanc_inbound_pending_instances where orthanc_instance_id like $1", [`${prefix}%`]);
    await state(null);
    await pool.end();
  }
});
