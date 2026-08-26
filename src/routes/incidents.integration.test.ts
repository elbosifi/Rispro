import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import test from "node:test";
import jwt from "jsonwebtoken";

process.env.DATABASE_URL ||= "postgresql://rispro_test:rispro_test_password@localhost:5433/rispro_test";
process.env.JWT_SECRET ||= "incidents-route-test-secret";

test("incident routes enforce the create and review role matrix and keep attachment uploads scoped", async (t) => {
  const [{ pool }, { createApp }, { env }] = await Promise.all([import("../db/pool.js"), import("../app.js"), import("../config/env.js")]);
  try { await pool.query("select 1"); } catch { t.skip("PostgreSQL is not reachable at configured DATABASE_URL."); return; }
  const suffix = randomUUID().replace(/-/g, "").slice(0, 12); const userIds: number[] = []; const incidentIds: number[] = []; const documentIds: number[] = [];
  const createUser = async (role: string) => { const result = await pool.query<{ id: number }>("insert into users(username,full_name,password_hash,role,is_active) values($1,$2,'x',$3,true) returning id", [`incident_http_${role}_${suffix}`, `Incident ${role}`, role]); const id = result.rows[0]!.id; userIds.push(id); return `${env.cookieName}=${jwt.sign({ sub: id, role, username: role, fullName: role }, env.jwtSecret)}`; };
  const equipment = await pool.query<{ id: number }>("insert into equipment(name,equipment_type,modality,vendor,model,location,is_active) values($1,'WORKSTATION',null,'test','test','test',true) returning id", [`Incident route workstation ${suffix}`]);
  const cookies = new Map(await Promise.all(["receptionist", "modality_staff", "doctor", "administrative", "supervisor", "super_admin"].map(async (role) => [role, await createUser(role)] as const)));
  const server = http.createServer(createApp()); await new Promise<void>((resolve) => server.listen(0, resolve)); const port = (server.address() as { port: number }).port;
  const request = async (path: string, cookie: string, method: "POST" | "PATCH", body: unknown) => fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
  try {
    for (const role of cookies.keys()) {
      const response = await request("/api/incidents", cookies.get(role)!, "POST", { incidentType: "equipment", occurredAt: "2026-08-27T10:00:00.000Z", equipmentId: equipment.rows[0]!.id, equipmentCondition: "operational", description: `create ${role}` });
      assert.equal(response.status, 201, role); const payload = await response.json() as { incident: { id: number } }; incidentIds.push(payload.incident.id);
    }
    const reviewId = incidentIds[0]!;
    for (const role of ["administrative", "supervisor", "super_admin"]) assert.equal((await request(`/api/incidents/${reviewId}/review`, cookies.get(role)!, "PATCH", { status: "under_review", reviewNotes: "review" })).status, 200, role);
    for (const role of ["receptionist", "modality_staff", "doctor"]) assert.equal((await request(`/api/incidents/${reviewId}/review`, cookies.get(role)!, "PATCH", { status: "under_review", reviewNotes: "review" })).status, 403, role);
    const blocked = await request("/api/documents", cookies.get("receptionist")!, "POST", { incidentId: reviewId, documentType: "incident_attachment", originalFilename: "bypass.pdf", mimeType: "application/pdf", fileContentBase64: Buffer.from("pdf").toString("base64") });
    assert.equal(blocked.status, 400); assert.match(JSON.stringify(await blocked.json()), /incidentId.*incident attachment/i); assert.equal((await pool.query("select 1 from documents where incident_id=$1", [reviewId])).rowCount, 0);
    const attachment = await request(`/api/incidents/${reviewId}/attachments`, cookies.get("receptionist")!, "POST", { originalFilename: "attachment.png", mimeType: "image/png", fileContentBase64: Buffer.from("png").toString("base64") });
    assert.equal(attachment.status, 201); const attachmentPayload = await attachment.json() as { document: { id: number; stored_path?: string; content_sha256?: string } }; documentIds.push(attachmentPayload.document.id); assert.equal(attachmentPayload.document.stored_path, undefined); assert.equal(attachmentPayload.document.content_sha256, undefined);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (documentIds.length) await pool.query("delete from documents where id=any($1::bigint[])", [documentIds]);
    if (incidentIds.length) { await pool.query("delete from audit_log where entity_type='incident' and entity_id=any($1::bigint[])", [incidentIds]); await pool.query("delete from department_incidents where id=any($1::bigint[])", [incidentIds]); }
    await pool.query("delete from equipment where id=$1", [equipment.rows[0]!.id]);
    if (userIds.length) { await pool.query("delete from audit_log where changed_by_user_id=any($1::bigint[])", [userIds]); await pool.query("delete from users where id=any($1::bigint[])", [userIds]); }
  }
});
