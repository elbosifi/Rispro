import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import jwt from "jsonwebtoken";
import test from "node:test";
import { env } from "../config/env.js";
import { pool } from "../db/pool.js";
import { createApp } from "../app.js";
import { sha256Buffer } from "../services/backup-v3-checksums.js";

test("document view falls back to verified HA bytes with the normal binary response headers", async () => {
  const marker = crypto.randomUUID();
  const user = await pool.query<{ id: number }>(
    "insert into users(username,full_name,password_hash,role,is_active) values($1,$2,'test','receptionist',true) returning id",
    [`documents_route_${marker}`, `Documents route ${marker}`],
  );
  const userId = Number(user.rows[0]!.id);
  const content = Buffer.from(`route-ha-${marker}`);
  const digest = sha256Buffer(content);
  const document = await pool.query<{ id: number }>(
    `insert into documents(document_type,original_filename,stored_path,mime_type,file_size,content_sha256,storage_location_type,source)
     values('appointment_request',$1,$2,'application/pdf',$3,$4,'local_fallback','manual_upload') returning id`,
    [`route-${marker}.pdf`, `route-missing-${marker}.pdf`, content.length, digest],
  );
  const documentId = Number(document.rows[0]!.id);
  await pool.query(
    `insert into document_ha_blobs(document_id,content,byte_size,content_sha256,retention_due_at)
     values($1,$2,$3,$4,now()+interval '48 hours')`,
    [documentId, content, content.length, digest],
  );
  const server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  const cookie = `${env.cookieName}=${jwt.sign({ sub: userId, role: "receptionist", username: `documents_route_${marker}` }, env.jwtSecret)}`;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/documents/${documentId}/view`, { headers: { cookie } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.match(response.headers.get("content-disposition") || "", /inline; filename="route-.*\.pdf"/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), content);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.query("delete from documents where id=$1", [documentId]);
    await pool.query("delete from audit_log where changed_by_user_id=$1", [userId]);
    await pool.query("delete from users where id=$1", [userId]);
  }
});
