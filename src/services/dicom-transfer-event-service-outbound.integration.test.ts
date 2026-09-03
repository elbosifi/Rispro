import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.DATABASE_URL ||= "postgresql://127.0.0.1/rispro_test";
process.env.JWT_SECRET ||= "test-secret";

const [{ pool }, { recordInboundDicomReception, recordOutboundDicomTransfer }] = await Promise.all([
  import("../db/pool.js"),
  import("./dicom-transfer-event-service.js"),
]);

test("records outbound DICOM sends idempotently through all Orthanc status transitions", async () => {
  const token = randomUUID().replaceAll("-", "").slice(0, 12);
  const jobId = `outbound-${token}`;
  const studyUid = `2.25.${Date.now()}.${token}`;
  const secondStudyUid = `${studyUid}.2`;
  const receivedResourceId = `received-${token}`;
  const firstSeenAt = "2026-09-03T10:00:00.123Z";
  const activeLastSeenAt = "2026-09-03T10:00:01.123Z";
  const successCompletedAt = "2026-09-03T10:00:41.456Z";
  const failedCompletedAt = "2026-09-03T10:01:00.000Z";

  const outbound = (overrides: Record<string, unknown> = {}) => ({
    orthancJobId: jobId,
    patientId: "PATIENT-1",
    patientName: "Patient One",
    accessionNumber: "ACC-1",
    studyInstanceUid: studyUid,
    studyDescription: "CT chest",
    sourceAet: "orthancpg",
    destinationAet: "pacs1",
    instanceCount: 0,
    status: "ACTIVE",
    firstSeenAt,
    lastSeenAt: activeLastSeenAt,
    completedAt: null,
    ...overrides,
  });

  try {
    const active = await recordOutboundDicomTransfer(outbound());
    assert.equal(active.event.direction, "SENT");
    assert.equal(active.event.status, "ACTIVE");
    assert.equal(active.event.source_aet, "ORTHANCPG");
    assert.equal(active.event.destination_aet, "PACS1");
    assert.equal(active.event.source_ip, null);
    assert.equal(active.event.orthanc_change_sequence, null);
    assert.equal(active.event.instance_count, 0);
    assert.equal(active.event.completed_at, null);

    const original = await pool.query<{ id: string; first_seen_at: string; created_at: string }>("select id::text,first_seen_at::text,created_at::text from dicom_transfer_events where direction='SENT' and orthanc_job_id=$1 and study_instance_uid=$2", [jobId, studyUid]);
    assert.equal(original.rowCount, 1);

    const repeated = await recordOutboundDicomTransfer(outbound({ patientName: "Patient One Updated", instanceCount: 25, lastSeenAt: "2026-09-03T10:00:02.000Z" }));
    assert.equal(repeated.event.id, active.event.id);
    assert.equal((await pool.query("select 1 from dicom_transfer_events where direction='SENT' and orthanc_job_id=$1 and study_instance_uid=$2", [jobId, studyUid])).rowCount, 1);
    assert.equal(repeated.event.patient_name, "Patient One Updated");
    assert.equal(repeated.event.instance_count, 25);

    const success = await recordOutboundDicomTransfer(outbound({ status: "SUCCESS", lastSeenAt: successCompletedAt, completedAt: successCompletedAt, instanceCount: 903 }));
    assert.equal(success.event.id, active.event.id);
    assert.equal(success.event.status, "SUCCESS");
    const successCompleted = success.event.completed_at as unknown;
    assert.equal(successCompleted instanceof Date ? successCompleted.toISOString() : successCompleted, successCompletedAt);
    assert.equal(success.event.error_code, null);
    assert.equal(success.event.error_message, null);

    const failed = await recordOutboundDicomTransfer(outbound({ status: "FAILED", lastSeenAt: failedCompletedAt, completedAt: failedCompletedAt, errorCode: 17, errorMessage: "Authorization: Bearer secret\nremote detail" }));
    assert.equal(failed.event.id, active.event.id);
    assert.equal(failed.event.status, "FAILED");
    assert.equal(failed.event.error_code, "17");
    assert.match(failed.event.error_message || "", /remote detail/);
    assert.doesNotMatch(failed.event.error_message || "", /secret/);

    const resumed = await recordOutboundDicomTransfer(outbound({ lastSeenAt: "2026-09-03T10:02:00.000Z", completedAt: failedCompletedAt, errorCode: "old", errorMessage: "old failure" }));
    assert.equal(resumed.event.id, active.event.id);
    assert.equal(resumed.event.status, "ACTIVE");
    assert.equal(resumed.event.completed_at, null);
    assert.equal(resumed.event.error_code, null);
    assert.equal(resumed.event.error_message, null);

    const finalSuccess = await recordOutboundDicomTransfer(outbound({ status: "SUCCESS", lastSeenAt: successCompletedAt, completedAt: successCompletedAt }));
    assert.equal(finalSuccess.event.id, active.event.id);
    assert.equal(finalSuccess.event.status, "SUCCESS");
    assert.equal(finalSuccess.event.error_code, null);
    assert.equal(finalSuccess.event.error_message, null);

    const final = await pool.query<{ first_seen_at: string; created_at: string; source_aet: string; destination_aet: string }>("select first_seen_at::text,created_at::text,source_aet,destination_aet from dicom_transfer_events where id=$1", [active.event.id]);
    assert.equal(final.rows[0]?.first_seen_at, original.rows[0]?.first_seen_at);
    assert.equal(final.rows[0]?.created_at, original.rows[0]?.created_at);
    assert.equal(final.rows[0]?.source_aet, "ORTHANCPG");
    assert.equal(final.rows[0]?.destination_aet, "PACS1");

    await recordOutboundDicomTransfer(outbound({ studyInstanceUid: secondStudyUid }));
    assert.equal((await pool.query("select 1 from dicom_transfer_events where direction='SENT' and orthanc_job_id=$1", [jobId])).rowCount, 2);

    const received = await recordInboundDicomReception({
      patientId: "RECEIVED-PATIENT",
      patientName: "Received Patient",
      studyInstanceUid: `${studyUid}.received`,
      sourceAet: "SOURCE_AE",
      sourceIp: "192.0.2.10",
      destinationAet: "ORTHANCPG",
      instanceCount: 2,
      completedAt: "2026-09-03T11:00:00.000Z",
      orthancChangeSequence: Number(`${Date.now()}${Math.floor(Math.random() * 10)}`),
      orthancResourceId: receivedResourceId,
    });
    assert.equal(received.event.direction, "RECEIVED");
    assert.equal(received.event.status, "SUCCESS");
    assert.equal((await recordInboundDicomReception({
      patientId: "RECEIVED-PATIENT",
      patientName: "Received Patient",
      studyInstanceUid: `${studyUid}.received`,
      sourceAet: "SOURCE_AE",
      sourceIp: "192.0.2.10",
      destinationAet: "ORTHANCPG",
      instanceCount: 2,
      completedAt: "2026-09-03T11:00:00.000Z",
      orthancChangeSequence: received.event.orthanc_change_sequence,
      orthancResourceId: receivedResourceId,
    })).deduplicated, true);
  } finally {
    await pool.query("delete from dicom_transfer_events where orthanc_job_id=$1 or orthanc_resource_id=$2", [jobId, receivedResourceId]);
    await pool.end();
  }
});
