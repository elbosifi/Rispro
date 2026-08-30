import assert from "node:assert/strict";
import test from "node:test";

process.env.DATABASE_URL ||= "postgresql://127.0.0.1/rispro_test";
process.env.JWT_SECRET ||= "test-secret";

test("Authoritative Orthanc inbound audit consumes raw StableStudy changes without collapsing episodes", async (t) => {
  const [{ pool }, worker] = await Promise.all([import("../db/pool.js"), import("./authoritative-orthanc-inbound-audit-worker.js")]);
  const studyId = `audit-test-study-${Date.now()}`;
  const studyUid = `2.25.${Date.now()}${Math.floor(Math.random() * 1_000_000)}`;
  const state = async (sequence: number | null) => pool.query("update authoritative_orthanc_inbound_audit_state set last_change_sequence=$1,last_success_at=null,last_error=null,updated_at=now() where singleton_key=true", [sequence]);
  const study = { study: { orthancStudyId: studyId, patientId: "PAT-1", patientName: "Inbound^Patient", accessionNumber: "ACC-1", studyInstanceUid: studyUid, studyDescription: "CT chest", patientBirthDate: null, patientSex: null, studyDate: null, modalitiesInStudy: ["CT"], seriesCount: 1, instanceCount: 3 }, instanceIds: ["instance-a", "instance-b", "instance-c"] };
  const stable = (sequence: number) => ({ sequence, changeType: "StableStudy", resourceType: "Study", resourceId: studyId, date: "20260830T100200" });
  const client = (changes: Array<ReturnType<typeof stable>>, metadata: Array<{ orthancInstanceId: string; origin: string | null; remoteAet: string | null; remoteIp: string | null; calledAet: string | null; receptionDate: string | null }>) => ({
    async getChanges(since: number) {
      if (since === 0 && changes.length && changes[0]!.sequence <= 50) return { changes, lastSequence: changes.at(-1)!.sequence, done: true };
      return { changes: changes.filter((change) => change.sequence > since), lastSequence: changes.at(-1)?.sequence ?? since, done: true };
    },
    async getStudyForInboundAudit() { return study; },
    async getInstanceReceptionMetadata(id: string) { return metadata.find((item) => item.orthancInstanceId === id) || { orthancInstanceId: id, origin: "RestApi", remoteAet: null, remoteIp: null, calledAet: null, receptionDate: null }; },
  });
  const dicomGroup = [
    { orthancInstanceId: "instance-a", origin: "DicomProtocol", remoteAet: "CT_AE", remoteIp: "10.0.0.10", calledAet: "ORTHANCPG", receptionDate: "20260830T100000" },
    { orthancInstanceId: "instance-b", origin: "DicomProtocol", remoteAet: "CT_AE", remoteIp: "10.0.0.10", calledAet: "ORTHANCPG", receptionDate: "20260830T100100" },
    { orthancInstanceId: "instance-c", origin: "RestApi", remoteAet: "RISPRO", remoteIp: "127.0.0.1", calledAet: "ORTHANCPG", receptionDate: "20260830T100101" },
  ];
  try {
    await pool.query("delete from dicom_transfer_events where orthanc_resource_id=$1", [studyId]);
    await state(null);
    await t.test("first run baselines the tail and does not backfill StableStudy events", async () => {
      const initial = await worker.runAuthoritativeOrthancInboundAuditCycle(async () => client([{ ...stable(50), date: "20260830T090000" }], dicomGroup));
      assert.deepEqual(initial, { lockAcquired: true, mode: "initialized", recorded: 0, lastSequence: 50 });
      assert.equal((await pool.query("select 1 from dicom_transfer_events where orthanc_resource_id=$1", [studyId])).rowCount, 0);
    });
    await t.test("one StableStudy persists only DICOM-origin instances with source metadata", async () => {
      const result = await worker.runAuthoritativeOrthancInboundAuditCycle(async () => client([stable(51)], dicomGroup));
      assert.deepEqual(result, { lockAcquired: true, mode: "processed", recorded: 1, lastSequence: 51 });
      const row = (await pool.query<{ direction: string; status: string; patient_id: string; patient_name: string; accession_number: string; study_instance_uid: string; source_aet: string; source_ip: string; destination_aet: string; instance_count: number; orthanc_change_sequence: string; orthanc_resource_id: string; first_seen_at: string; last_seen_at: string; completed_at: string }>("select direction,status,patient_id,patient_name,accession_number,study_instance_uid,source_aet,source_ip,destination_aet,instance_count,orthanc_change_sequence::text,orthanc_resource_id,first_seen_at::text,last_seen_at::text,completed_at::text from dicom_transfer_events where orthanc_resource_id=$1 and orthanc_change_sequence=51", [studyId])).rows[0];
      assert.deepEqual(row && { direction: row.direction, status: row.status, patientId: row.patient_id, patientName: row.patient_name, accession: row.accession_number, studyUid: row.study_instance_uid, sourceAet: row.source_aet, sourceIp: row.source_ip, destination: row.destination_aet, count: row.instance_count, sequence: row.orthanc_change_sequence, resource: row.orthanc_resource_id }, { direction: "RECEIVED", status: "SUCCESS", patientId: "PAT-1", patientName: "Inbound^Patient", accession: "ACC-1", studyUid, sourceAet: "CT_AE", sourceIp: "10.0.0.10", destination: "ORTHANCPG", count: 2, sequence: "51", resource: studyId });
      assert.ok(row?.first_seen_at && row?.last_seen_at && row?.completed_at);
    });
    await t.test("retrying the same StableStudy source group deduplicates but a later sequence is preserved", async () => {
      await state(50);
      assert.equal((await worker.runAuthoritativeOrthancInboundAuditCycle(async () => client([stable(51)], dicomGroup))).recorded, 1);
      assert.equal((await pool.query("select 1 from dicom_transfer_events where orthanc_resource_id=$1 and orthanc_change_sequence=51", [studyId])).rowCount, 1);
      const later = await worker.runAuthoritativeOrthancInboundAuditCycle(async () => client([stable(52)], dicomGroup));
      assert.equal(later.recorded, 1);
      assert.equal((await pool.query("select 1 from dicom_transfer_events where orthanc_resource_id=$1 and orthanc_change_sequence in (51,52)", [studyId])).rowCount, 2);
    });
    await t.test("multiple DICOM source groups create distinct rows while REST, Lua, and plugin origins are ignored", async () => {
      const origins = [
        { orthancInstanceId: "instance-a", origin: "DicomProtocol", remoteAet: "CT_AE", remoteIp: "10.0.0.10", calledAet: "ORTHANCPG", receptionDate: "20260830T100000" },
        { orthancInstanceId: "instance-b", origin: "DicomProtocol", remoteAet: "MR_AE", remoteIp: "10.0.0.11", calledAet: "ARCHIVE_AE", receptionDate: null },
        { orthancInstanceId: "instance-c", origin: "Lua", remoteAet: "LUA", remoteIp: null, calledAet: null, receptionDate: null },
      ];
      const multi = { ...study, instanceIds: ["instance-a", "instance-b", "instance-c", "rest", "plugin"] };
      const multiClient = { ...client([stable(53)], origins), async getStudyForInboundAudit() { return multi; }, async getInstanceReceptionMetadata(id: string) { return origins.find((item) => item.orthancInstanceId === id) || { orthancInstanceId: id, origin: id === "plugin" ? "Plugins" : "RestApi", remoteAet: null, remoteIp: null, calledAet: null, receptionDate: null }; } };
      const result = await worker.runAuthoritativeOrthancInboundAuditCycle(async () => multiClient);
      assert.equal(result.recorded, 2);
      const rows = await pool.query<{ source_aet: string; source_ip: string; destination_aet: string; instance_count: number }>("select source_aet,source_ip,destination_aet,instance_count from dicom_transfer_events where orthanc_resource_id=$1 and orthanc_change_sequence=53 order by source_aet", [studyId]);
      assert.deepEqual(rows.rows, [{ source_aet: "CT_AE", source_ip: "10.0.0.10", destination_aet: "ORTHANCPG", instance_count: 1 }, { source_aet: "MR_AE", source_ip: "10.0.0.11", destination_aet: "ARCHIVE_AE", instance_count: 1 }]);
    });
    await t.test("a cleared or reset Orthanc changes feed is rebaselined without creating history", async () => {
      await state(200);
      const result = await worker.runAuthoritativeOrthancInboundAuditCycle(async () => client([stable(100)], dicomGroup));
      assert.deepEqual(result, { lockAcquired: true, mode: "rebaselined", recorded: 0, lastSequence: 100 });
      assert.equal((await pool.query("select 1 from dicom_transfer_events where orthanc_resource_id=$1 and orthanc_change_sequence=100", [studyId])).rowCount, 0);
    });
    await t.test("failed StableStudy processing preserves the cursor, and HA advisory locking prevents another consumer", async () => {
      const before = (await pool.query<{ last_change_sequence: string }>("select last_change_sequence::text from authoritative_orthanc_inbound_audit_state where singleton_key=true")).rows[0]?.last_change_sequence;
      const failed = await worker.runAuthoritativeOrthancInboundAuditCycle(async () => ({ ...client([stable(101)], dicomGroup), async getStudyForInboundAudit() { throw new Error("study unavailable"); } }));
      assert.equal(failed.mode, "failed");
      assert.equal((await pool.query<{ last_change_sequence: string }>("select last_change_sequence::text from authoritative_orthanc_inbound_audit_state where singleton_key=true")).rows[0]?.last_change_sequence, before);
      const lock = await pool.connect();
      try {
        await lock.query("select pg_advisory_lock(712364093)");
        assert.deepEqual(await worker.runAuthoritativeOrthancInboundAuditCycle(async () => client([stable(101)], dicomGroup)), { lockAcquired: false, mode: "processed", recorded: 0, lastSequence: null });
      } finally { await lock.query("select pg_advisory_unlock(712364093)"); lock.release(); }
    });
    await t.test("Orthanc unavailability is isolated as a failed worker cycle", async () => {
      const result = await worker.runAuthoritativeOrthancInboundAuditCycle(async () => { throw new Error("Orthanc unavailable"); });
      assert.equal(result.mode, "failed");
      assert.equal(result.lockAcquired, true);
    });
  } finally {
    await pool.query("delete from dicom_transfer_events where orthanc_resource_id=$1", [studyId]);
    await state(null);
    await pool.end();
  }
});
