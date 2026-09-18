import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { pool } from "../../db/pool.js";

test("migration 212 creates immutable SOP metadata and version tables", async () => {
  const client = await pool.connect();
  const marker = `SOP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  let userId: number | null = null;
  let sopId: number | null = null;
  try {
    await client.query("begin");
    const user = await client.query<{ id: number }>("insert into users(username,full_name,password_hash,role,is_active) values($1,$2,'test','supervisor',true) returning id", [`sop_migration_${marker.toLowerCase()}`, "SOP migration test"]);
    assert.equal(user.rowCount, 1);
    userId = Number(user.rows[0]!.id);
    const sop = await client.query<{ id: number }>("insert into sops(code,title,category,created_by_user_id) values($1,$2,$3,$4) returning id", [marker, "Unicode SOP", "General", userId]);
    sopId = Number(sop.rows[0]!.id);
    const content = { type: "sop", version: 1, sections: [{ key: "purpose", title: "Purpose", required: true, content: { type: "doc", content: [{ type: "paragraph", attrs: { dir: "rtl" }, content: [{ type: "text", text: "سلام MRI" }] }] } }] };
    await client.query("insert into sop_versions(sop_id,version,content_json,created_by_user_id) values($1,'1.0',$2::jsonb,$3)", [sopId, JSON.stringify(content), userId]);
    const row = await client.query<{ content_json: typeof content }>("select content_json from sop_versions where sop_id=$1", [sopId]);
    assert.equal((row.rows[0]!.content_json as { type: string }).type, "sop");
    assert.match(JSON.stringify(row.rows[0]!.content_json), /سلام MRI/);
    await client.query("commit");
  } finally {
    if (sopId != null) await client.query("delete from sop_versions where sop_id=$1", [sopId]).catch(() => undefined);
    if (sopId != null) await client.query("delete from sops where id=$1", [sopId]).catch(() => undefined);
    if (userId != null) await client.query("delete from users where id=$1", [userId]).catch(() => undefined);
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
});
