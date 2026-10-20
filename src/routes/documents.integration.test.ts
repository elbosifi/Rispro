import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
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

test("patient identity document viewer prevents browser caching", async () => {
  const marker = crypto.randomUUID();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-documents-route-"));
  const identityPath = path.join(tempDir, "identity.pdf");
  const appointmentPath = path.join(tempDir, "appointment.pdf");
  const identityHaPath = path.join(tempDir, "identity-ha-missing.pdf");
  const user = await pool.query<{ id: number }>(
    "insert into users(username,full_name,password_hash,role,is_active) values($1,$2,'test','receptionist',true) returning id",
    [`identity_cache_${marker}`, `Identity Cache ${marker}`],
  );
  const userId = Number(user.rows[0]!.id);
  const patient = await pool.query<{ id: number }>(
    `
      insert into patients(
        national_id,identifier_type,identifier_value,arabic_full_name,english_full_name,
        normalized_arabic_name,age_years,estimated_date_of_birth,sex,phone_1,address,
        created_by_user_id,updated_by_user_id
      ) values($1,'national_id',$2,$3,$4,$3,35,'1991-01-01','M','0912345678','Test',$5,$5)
      returning id
    `,
    [
      `9${marker.replace(/\D/g, "").slice(-11).padStart(11, "0")}`,
      `9${marker.replace(/\D/g, "").slice(-11).padStart(11, "0")}`,
      `هوية ${marker}`,
      `Identity ${marker}`,
      userId,
    ],
  );
  const patientId = Number(patient.rows[0]!.id);
  const identityContent = Buffer.from(`identity-route-${marker}`);
  const appointmentContent = Buffer.from(`appointment-route-${marker}`);
  const identityHaContent = Buffer.from(`identity-ha-route-${marker}`);
  await fs.writeFile(identityPath, identityContent);
  await fs.writeFile(appointmentPath, appointmentContent);
  const identity = await pool.query<{ id: number }>(
    `
      insert into documents(
        patient_id,document_type,original_filename,stored_path,mime_type,file_size,
        storage_location_type,source
      ) values($1,'patient_identity_document',$2,$3,'application/pdf',$4,'local_fallback','manual_upload')
      returning id
    `,
    [patientId, "identity.pdf", identityPath, identityContent.length],
  );
  const identityId = Number(identity.rows[0]!.id);
  const appointment = await pool.query<{ id: number }>(
    `
      insert into documents(
        document_type,original_filename,stored_path,mime_type,file_size,
        storage_location_type,source
      ) values('appointment_request',$1,$2,'application/pdf',$3,'local_fallback','manual_upload')
      returning id
    `,
    ["appointment.pdf", appointmentPath, appointmentContent.length],
  );
  const appointmentId = Number(appointment.rows[0]!.id);
  const haIdentity = await pool.query<{ id: number }>(
    `
      insert into documents(
        patient_id,document_type,original_filename,stored_path,mime_type,file_size,
        content_sha256,storage_location_type,source
      ) values($1,'patient_identity_document',$2,$3,'application/pdf',$4,$5,'local_fallback','manual_upload')
      returning id
    `,
    [patientId, "identity-ha.pdf", identityHaPath, identityHaContent.length, sha256Buffer(identityHaContent)],
  );
  const haIdentityId = Number(haIdentity.rows[0]!.id);
  await pool.query(
    `
      insert into document_ha_blobs(document_id,content,byte_size,content_sha256,retention_due_at)
      values($1,$2,$3,$4,now()+interval '48 hours')
    `,
    [haIdentityId, identityHaContent, identityHaContent.length, sha256Buffer(identityHaContent)],
  );
  const server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  const cookie = `${env.cookieName}=${jwt.sign({ sub: userId, role: "receptionist", username: `identity_cache_${marker}` }, env.jwtSecret)}`;

  try {
    const identityResponse = await fetch(`http://127.0.0.1:${port}/api/documents/${identityId}/view`, { headers: { cookie } });
    assert.equal(identityResponse.status, 200);
    assert.equal(identityResponse.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.equal(identityResponse.headers.get("pragma"), "no-cache");
    assert.equal(identityResponse.headers.get("expires"), "0");
    assert.deepEqual(Buffer.from(await identityResponse.arrayBuffer()), identityContent);

    const haIdentityResponse = await fetch(`http://127.0.0.1:${port}/api/documents/${haIdentityId}/view`, { headers: { cookie } });
    assert.equal(haIdentityResponse.status, 200);
    assert.equal(haIdentityResponse.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.equal(haIdentityResponse.headers.get("pragma"), "no-cache");
    assert.equal(haIdentityResponse.headers.get("expires"), "0");
    assert.deepEqual(Buffer.from(await haIdentityResponse.arrayBuffer()), identityHaContent);

    const appointmentResponse = await fetch(`http://127.0.0.1:${port}/api/documents/${appointmentId}/view`, { headers: { cookie } });
    assert.equal(appointmentResponse.status, 200);
    assert.notEqual(appointmentResponse.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.deepEqual(Buffer.from(await appointmentResponse.arrayBuffer()), appointmentContent);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.query("delete from document_ha_blobs where document_id=$1", [haIdentityId]);
    await pool.query("delete from documents where id=any($1::bigint[])", [[identityId, appointmentId, haIdentityId]]);
    await pool.query("delete from patients where id=$1", [patientId]);
    await pool.query("delete from audit_log where changed_by_user_id=$1", [userId]);
    await pool.query("delete from users where id=$1", [userId]);
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
