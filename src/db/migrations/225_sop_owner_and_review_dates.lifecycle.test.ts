import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { pool } from "../pool.js";

test("migration 225 adds nullable SOP owner and review dates safely", async () => {
  const client = await pool.connect();
  const marker = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const migration = await readFile(fileURLToPath(new URL("./225_sop_owner_and_review_dates.sql", import.meta.url)), "utf8");
  let ownerUserId: number | null = null;
  try {
    await client.query("begin");
    await client.query("alter table sops drop column if exists owner_user_id cascade");
    await client.query("alter table sop_versions drop column if exists next_review_date cascade");
    const actor = await client.query<{ id: number }>(
      "insert into users(username,full_name,password_hash,role,is_active) values($1,$2,'test','supervisor',true) returning id",
      [`sop_migration_actor_${marker}`, "SOP migration actor"],
    );
    const owner = await client.query<{ id: number }>(
      "insert into users(username,full_name,password_hash,role,is_active) values($1,$2,'test','doctor',true) returning id",
      [`sop_migration_owner_${marker}`, "SOP migration owner"],
    );
    const actorUserId = Number(actor.rows[0]!.id);
    ownerUserId = Number(owner.rows[0]!.id);
    const sop = await client.query<{ id: number }>(
      "insert into sops(code,title,category,created_by_user_id) values($1,'Legacy SOP','General',$2) returning id",
      [`SOP-MIGRATION-${marker}`, actorUserId],
    );
    const sopId = Number(sop.rows[0]!.id);
    const version = await client.query<{ id: number }>(
      "insert into sop_versions(sop_id,version,content_json,created_by_user_id) values($1,'1.0','{}'::jsonb,$2) returning id",
      [sopId, actorUserId],
    );
    const versionId = Number(version.rows[0]!.id);

    await client.query(migration);
    await client.query(migration);

    const columns = await client.query<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>(
      `select table_name, column_name, data_type, is_nullable
       from information_schema.columns
       where table_schema = 'public'
         and (table_name, column_name) in (('sops', 'owner_user_id'), ('sop_versions', 'next_review_date'))
       order by table_name, column_name`,
    );
    assert.deepEqual(columns.rows, [
      { table_name: "sop_versions", column_name: "next_review_date", data_type: "date", is_nullable: "YES" },
      { table_name: "sops", column_name: "owner_user_id", data_type: "bigint", is_nullable: "YES" },
    ]);

    const legacy = await client.query<{ owner_user_id: number | null; next_review_date: string | null }>(
      `select s.owner_user_id, v.next_review_date::text as next_review_date
       from sops s join sop_versions v on v.sop_id = s.id
       where s.id = $1 and v.id = $2`,
      [sopId, versionId],
    );
    assert.deepEqual(legacy.rows[0], { owner_user_id: null, next_review_date: null });

    await client.query("savepoint invalid_owner_reference");
    await assert.rejects(
      () => client.query("update sops set owner_user_id = $2 where id = $1", [sopId, 9223372036854775000n.toString()]),
      (error: unknown) => (error as { code?: string }).code === "23503",
    );
    await client.query("rollback to savepoint invalid_owner_reference");

    await client.query("update sops set owner_user_id = $2 where id = $1", [sopId, ownerUserId]);
    await client.query("update sop_versions set next_review_date = $2 where id = $1", [versionId, "2026-10-01"]);
    const storedDate = await client.query<{ next_review_date: string; value_type: string }>(
      "select next_review_date::text as next_review_date, pg_typeof(next_review_date)::text as value_type from sop_versions where id = $1",
      [versionId],
    );
    assert.deepEqual(storedDate.rows[0], { next_review_date: "2026-10-01", value_type: "date" });

    const indexes = await client.query<{ indexname: string }>(
      "select indexname from pg_indexes where schemaname = 'public' and indexname = any($1::text[]) order by indexname",
      [["sop_versions_next_review_date_idx", "sops_owner_user_id_idx"]],
    );
    assert.deepEqual(indexes.rows.map((row) => row.indexname), ["sop_versions_next_review_date_idx", "sops_owner_user_id_idx"]);

    const ownerConstraint = await client.query<{ definition: string }>(
      "select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid = 'sops'::regclass and conname = 'sops_owner_user_id_fkey'",
    );
    assert.match(ownerConstraint.rows[0]!.definition, /FOREIGN KEY \(owner_user_id\) REFERENCES users\(id\) ON DELETE SET NULL/i);
    await client.query("delete from users where id = $1", [ownerUserId]);
    ownerUserId = null;
    const afterOwnerDelete = await client.query<{ owner_user_id: number | null }>("select owner_user_id from sops where id = $1", [sopId]);
    assert.equal(afterOwnerDelete.rows[0]!.owner_user_id, null);
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
});
