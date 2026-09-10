import assert from "node:assert/strict";
import crypto from "node:crypto";
import { pool } from "../../db/pool.js";
import test from "node:test";

test("migration 205 creates bounded HA blob storage with safe retention and cascade behavior", async () => {
  const marker = crypto.randomUUID();
  const client = await pool.connect();
  let documentId: number | null = null;
  let committed = false;
  try {
    await client.query("begin");
    const schema = await client.query<{ column_name: string }>(
      `select column_name
       from information_schema.columns
       where table_name='document_ha_blobs'
       order by ordinal_position`,
    );
    assert.deepEqual(schema.rows.map((row) => row.column_name), [
      "document_id",
      "content",
      "byte_size",
      "content_sha256",
      "created_at",
      "retention_due_at",
      "reconciliation_lease_owner",
      "reconciliation_lease_expires_at",
    ]);

    const index = await client.query("select 1 from pg_indexes where indexname='document_ha_blobs_retention_due_at_idx'");
    assert.equal(index.rowCount, 1);
    const defaults = await client.query<{ setting_key: string; setting_value: unknown }>(
      "select setting_key, setting_value from system_settings where category='documents_and_uploads' and setting_key like 'ha_hot_storage_%' order by setting_key",
    );
    assert.deepEqual(defaults.rows, [
      { setting_key: "ha_hot_storage_enabled", setting_value: { value: "true" } },
      { setting_key: "ha_hot_storage_retention_hours", setting_value: { value: "48" } },
    ]);

    const document = await client.query<{ id: number }>(
      `insert into documents(document_type, original_filename, stored_path, mime_type, file_size, source)
       values('appointment_request', $1, $2, 'application/pdf', 2, 'manual_upload')
       returning id`,
      [`${marker}.pdf`, `uploads/${marker}.pdf`],
    );
    documentId = document.rows[0]!.id;
    const content = Buffer.from("HA");
    const digest = crypto.createHash("sha256").update(content).digest("hex");
    await client.query(
      `insert into document_ha_blobs(document_id, content, byte_size, content_sha256, retention_due_at)
       values($1, $2, $3, $4, now() + interval '48 hours')`,
      [documentId, content, content.length, digest],
    );
    const storedBlob = (await client.query<{ byte_size: number | string; content_sha256: string }>("select byte_size, content_sha256 from document_ha_blobs where document_id=$1", [documentId])).rows[0]!;
    assert.equal(Number(storedBlob.byte_size), 2);
    assert.equal(storedBlob.content_sha256, digest);

    await client.query("savepoint invalid_blob");
    await assert.rejects(() => client.query(
      `insert into document_ha_blobs(document_id, content, byte_size, content_sha256, retention_due_at)
       values($1, 'x', 0, $2, now() + interval '1 hour')`,
      [documentId, digest],
    ));
    await client.query("rollback to savepoint invalid_blob");

    await client.query("savepoint invalid_hash");
    await assert.rejects(() => client.query(
      `insert into document_ha_blobs(document_id, content, byte_size, content_sha256, retention_due_at)
       values($1, 'x', 1, 'invalid', now() + interval '1 hour')`,
      [documentId],
    ));
    await client.query("rollback to savepoint invalid_hash");

    await client.query("delete from documents where id=$1", [documentId]);
    assert.equal((await client.query("select 1 from document_ha_blobs where document_id=$1", [documentId])).rowCount, 0);
    await client.query("commit");
    committed = true;
  } finally {
    if (!committed) await client.query("rollback").catch(() => undefined);
    if (documentId != null && !committed) await client.query("delete from documents where id=$1", [documentId]).catch(() => undefined);
    client.release();
  }
});
