import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

process.env.DATABASE_URL ||= "postgresql://127.0.0.1/rispro_test";
process.env.JWT_SECRET ||= "test-secret";

test("internal Authoritative Orthanc reception ingest persists server-controlled inbound events", async () => {
  const [{ pool }, { createApp }, { env }] = await Promise.all([import("../db/pool.js"), import("../app.js"), import("../config/env.js")]);
  const marker = `received-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}/api/internal/authoritative-orthanc/received`;
  const payload = {
    patientId: `PAT-${marker}`,
    patientName: "Inbound Patient",
    accessionNumber: `ACC-${marker}`,
    studyInstanceUid: `2.25.${Date.now()}${Math.floor(Math.random() * 1_000_000)}`,
    studyDescription: "CT chest",
    sourceAet: "scanner_ae",
    sourceIp: null,
    instanceCount: 42,
    firstSeenAt: "2026-08-30T10:00:00.000Z",
    lastSeenAt: "2026-08-30T10:01:00.000Z",
    completedAt: "2026-08-30T10:02:00.000Z",
    direction: "SENT",
    status: "FAILED",
  };
  const request = (body: unknown, secret = env.jwtSecret) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-RISpro-Authoritative-Orthanc-Secret": secret }, body: JSON.stringify(body) });
  try {
    assert.equal((await request({ ...payload, studyInstanceUid: "" })).status, 400);
    assert.equal((await request(payload, "wrong-secret")).status, 401);
    const created = await request(payload);
    assert.equal(created.status, 201);
    const createdBody = await created.json() as { event: { id: number; direction: string; status: string; destination_aet: string; source_ip: string | null }; deduplicated: boolean };
    assert.equal(createdBody.deduplicated, false);
    assert.deepEqual({ direction: createdBody.event.direction, status: createdBody.event.status, destination: createdBody.event.destination_aet, sourceIp: createdBody.event.source_ip }, { direction: "RECEIVED", status: "SUCCESS", destination: "ORTHANCPG", sourceIp: null });
    const retry = await request(payload);
    assert.equal(retry.status, 200);
    assert.equal((await retry.json() as { deduplicated: boolean }).deduplicated, true);
    const rows = await pool.query<{ patient_id: string; patient_name: string; accession_number: string; source_aet: string; source_ip: string | null; instance_count: number; first_seen_at: string; last_seen_at: string; completed_at: string; created_at: string; updated_at: string }>("select patient_id,patient_name,accession_number,source_aet,source_ip,instance_count,first_seen_at,last_seen_at,completed_at,created_at,updated_at from dicom_transfer_events where study_instance_uid=$1", [payload.studyInstanceUid]);
    assert.equal(rows.rowCount, 1);
    assert.deepEqual(rows.rows[0] && { patientId: rows.rows[0].patient_id, patientName: rows.rows[0].patient_name, accession: rows.rows[0].accession_number, sourceAet: rows.rows[0].source_aet, sourceIp: rows.rows[0].source_ip, instanceCount: rows.rows[0].instance_count }, { patientId: payload.patientId, patientName: payload.patientName, accession: payload.accessionNumber, sourceAet: "SCANNER_AE", sourceIp: null, instanceCount: 42 });
    assert.ok(rows.rows[0]?.first_seen_at && rows.rows[0]?.last_seen_at && rows.rows[0]?.completed_at && rows.rows[0]?.created_at && rows.rows[0]?.updated_at);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.query("delete from dicom_transfer_events where patient_id=$1", [payload.patientId]);
    await pool.end();
  }
});
