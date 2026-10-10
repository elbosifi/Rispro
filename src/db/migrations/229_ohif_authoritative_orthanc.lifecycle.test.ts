import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { pool } from "../pool.js";

test.after(async () => { await pool.end(); });

test("migration 229 preserves PACS rows and separates authoritative archive mappings and sessions", async () => {
  const client = await pool.connect();
  const schema = `ohif_migration_${randomUUID().replaceAll("-", "")}`;
  try {
    await client.query("begin");
    await client.query(`create schema ${schema}`);
    await client.query(`set local search_path to ${schema}`);
    // Reproduce the pre-migration source constraints without unrelated clinical fixtures.
    await client.query(`
      create table ohif_viewer_settings (
        id integer primary key, selected_pacs_node_id bigint,
        access_strategy text not null check(access_strategy in ('native_dicomweb','orthanc_gateway'))
      );
      create table viewer_launch_sessions (
        id integer primary key, source_pacs_node_id bigint not null,
        access_strategy text not null check(access_strategy in ('native_dicomweb','orthanc_gateway'))
      );
      create table study_source_resolutions (
        id integer primary key, appointment_id bigint not null,
        accession_number text not null, study_instance_uid text not null, source_pacs_node_id bigint not null,
        unique(appointment_id,source_pacs_node_id), unique(source_pacs_node_id,accession_number,study_instance_uid)
      );
      insert into ohif_viewer_settings values(1,7,'native_dicomweb');
      insert into viewer_launch_sessions values(1,7,'native_dicomweb');
      insert into study_source_resolutions values(1,42,'ACC-42','1.2.42',7);
    `);
    await client.query(await readFile(new URL("./229_ohif_authoritative_orthanc.sql", import.meta.url), "utf8"));
    assert.deepEqual((await client.query(`select source_kind,source_pacs_node_id::text from study_source_resolutions where id=1`)).rows[0], { source_kind: "pacs", source_pacs_node_id: "7" });
    assert.equal((await client.query(`select access_strategy from viewer_launch_sessions where id=1`)).rows[0]?.access_strategy, "native_dicomweb");
    await client.query(`update ohif_viewer_settings set access_strategy='authoritative_orthanc',selected_pacs_node_id=null where id=1`);
    await client.query(`insert into viewer_launch_sessions values(2,null,'authoritative_orthanc')`);
    await client.query(`insert into study_source_resolutions values(2,42,'ACC-42','1.2.42',null,'authoritative_orthanc')`);
    assert.equal((await client.query(`select count(*)::int as count from study_source_resolutions where appointment_id=42`)).rows[0]?.count, 2);

    async function rejects(sql: string, code: string) {
      await client.query("savepoint expected_failure");
      await assert.rejects(() => client.query(sql), (error: unknown) => (error as { code: string }).code === code);
      await client.query("rollback to savepoint expected_failure");
    }
    await rejects(`insert into viewer_launch_sessions values(3,null,'native_dicomweb')`, "23514");
    await rejects(`insert into viewer_launch_sessions values(3,7,'authoritative_orthanc')`, "23514");
    await rejects(`insert into study_source_resolutions values(3,42,'OTHER','1.2.43',null,'authoritative_orthanc')`, "23505");
    await rejects(`insert into study_source_resolutions values(3,43,'ACC-42','1.2.42',null,'authoritative_orthanc')`, "23505");
    await rejects(`insert into study_source_resolutions values(3,43,'OTHER','1.2.43',null,'pacs')`, "23514");
    await rejects(`insert into study_source_resolutions values(3,42,'OTHER','1.2.43',7,'pacs')`, "23505");
  } finally {
    await client.query("rollback");
    client.release();
  }
});
