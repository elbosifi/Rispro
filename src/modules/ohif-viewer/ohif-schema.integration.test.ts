import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

process.env.DATABASE_URL ||= "postgresql://rispro_test:rispro_test_password@localhost:5433/rispro_test";
process.env.JWT_SECRET ||= "test-secret-test-secret-test-secret";

const { pool } = await import("../../db/pool.js");

after(async () => { await pool.end(); });

describe("OHIF schema integration", () => {
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
      [["123_ohif_viewer_integration.sql", "124_ohif_viewer_hardening.sql"]]
    );
    assert.deepEqual(migrations.rows.map((row) => row.filename), ["123_ohif_viewer_integration.sql", "124_ohif_viewer_hardening.sql"]);
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
