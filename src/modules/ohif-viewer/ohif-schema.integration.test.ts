import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

process.env.DATABASE_URL ||= "postgresql://rispro_test:rispro_test_password@localhost:5433/rispro_test";
process.env.JWT_SECRET ||= "test-secret-test-secret-test-secret";

const { pool } = await import("../../db/pool.js");

after(async () => { await pool.end(); });

describe("OHIF schema integration", () => {
  it("defaults progressive loading OFF and persists ON/OFF in existing viewer settings", async () => {
    const column = (await pool.query("select column_default,is_nullable from information_schema.columns where table_schema='public' and table_name='ohif_viewer_settings' and column_name='progressive_loading_enabled'")).rows[0];
    assert.match(column.column_default, /false/);
    assert.equal(column.is_nullable, 'NO');
    const { readOhifViewerConfiguration } = await import('./repository.js');
    const client = await pool.connect();
    try {
      await client.query('begin');
      for (const enabled of [true, false]) {
        await client.query('update ohif_viewer_settings set progressive_loading_enabled=$1 where singleton_key=true', [enabled]);
        assert.equal((await readOhifViewerConfiguration(client)).settings.progressiveLoadingEnabled, enabled);
      }
    } finally { await client.query('rollback'); client.release(); }
  });
  it("persists current acquisitions separately from the complete authorization allowlist", async () => {
    const column = (await pool.query("select data_type,column_default,is_nullable from information_schema.columns where table_schema='public' and table_name='viewer_launch_sessions' and column_name='current_study_uids'")).rows[0];
    assert.equal(column.data_type, "jsonb");
    assert.equal(column.is_nullable, "NO");
    assert.equal(column.column_default, "'[]'::jsonb");
    assert.equal((await pool.query("select count(*)::int n from viewer_launch_sessions where not (permitted_study_uids @> current_study_uids)")).rows[0].n, 0);
  });
  it("keeps native reporting opt-in with unique appointment ownership and protected history/image tables",async()=>{
    const column=(await pool.query("select column_default from information_schema.columns where table_schema='public' and table_name='ohif_viewer_settings' and column_name='native_reporting_enabled'")).rows[0];
    assert.match(column.column_default,/false/);
    for(const name of ["native_reports","native_report_versions","native_report_key_images"]){
      assert.equal((await pool.query("select to_regclass($1) is not null present",[name])).rows[0].present,true);
    }
    const unique=(await pool.query("select indexdef from pg_indexes where schemaname='public' and tablename='native_reports' and indexname='native_reports_legacy_appointment_idx'")).rows;
    assert.equal(unique.length, 1);
    assert.match(unique[0].indexdef, /CREATE UNIQUE INDEX .*\(appointment_id\) WHERE \(legacy_primary AND \(deleted_at IS NULL\)\)/);
    const triggers=(await pool.query("select tgname from pg_trigger where tgrelid in ('native_reports'::regclass,'native_report_versions'::regclass,'native_report_key_images'::regclass) and not tgisinternal")).rows;
    assert.deepEqual(triggers.map(t=>t.tgname).sort(),['native_primary_signature_guard','native_report_history_immutable','native_report_image_immutable','native_signed_report_immutable']);
  });
  it("has all normalized OHIF tables, a singleton settings row, and the hardening migration", async () => {
    const tables = await pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema=current_schema() and table_name = any($1::text[])
       order by table_name`,
      [["pacs_web_endpoints", "ohif_viewer_settings", "study_source_resolutions", "viewer_launch_sessions", "ohif_retrieval_jobs"]]
    );
    assert.deepEqual(tables.rows.map((row) => row.table_name), [
      "ohif_retrieval_jobs", "ohif_viewer_settings", "pacs_web_endpoints", "study_source_resolutions", "viewer_launch_sessions",
    ]);

    const settings = await pool.query<{ count: string }>(`select count(*)::text as count from ohif_viewer_settings where singleton_key=true`);
    assert.equal(settings.rows[0]?.count, "1");

    const migrations = await pool.query<{ filename: string }>(
      `select filename from schema_migrations where filename = any($1::text[]) order by filename`,
      [["123_ohif_viewer_integration.sql", "124_ohif_viewer_hardening.sql", "229_ohif_authoritative_orthanc.sql"]]
    );
    assert.deepEqual(migrations.rows.map((row) => row.filename), ["123_ohif_viewer_integration.sql", "124_ohif_viewer_hardening.sql", "229_ohif_authoritative_orthanc.sql"]);
  });

  it("has viewer-session and exact-cache ownership columns with foreign keys", async () => {
    const columns = await pool.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
       where table_schema=current_schema()
         and (table_name='viewer_launch_sessions' and column_name='viewer_session_token_hash'
              or table_name='ohif_retrieval_jobs' and column_name = any($1::text[]))
       order by table_name, column_name`,
      [["preexisting_orthanc_study_ids", "owned_orthanc_study_id", "cache_ownership_proven"]]
    );
    assert.deepEqual(columns.rows.map((row) => `${row.table_name}.${row.column_name}`), [
      "ohif_retrieval_jobs.cache_ownership_proven",
      "ohif_retrieval_jobs.owned_orthanc_study_id",
      "ohif_retrieval_jobs.preexisting_orthanc_study_ids",
      "viewer_launch_sessions.viewer_session_token_hash",
    ]);

    const foreignKeys = await pool.query<{ count: string }>(
      `select count(*)::text as count from pg_constraint
       where contype='f' and conrelid in ('pacs_web_endpoints'::regclass, 'ohif_viewer_settings'::regclass,
         'study_source_resolutions'::regclass, 'viewer_launch_sessions'::regclass, 'ohif_retrieval_jobs'::regclass)`
    );
    assert.ok(Number(foreignKeys.rows[0]?.count || "0") >= 8);
  });
});
