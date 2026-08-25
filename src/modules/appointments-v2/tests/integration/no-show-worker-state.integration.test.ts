import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "../../../../db/pool.js";
import { recordNoShowWorkerState } from "../../booking/services/no-show-review.service.js";

test.after(async () => {
  await pool.end();
});

test("no-show worker state persists null and textual last_error values in PostgreSQL", async () => {
  const original = await pool.query("select * from appointments_v2.no_show_worker_state where singleton = true");
  try {
    await pool.query("delete from appointments_v2.no_show_worker_state where singleton = true");
    await pool.query(`insert into appointments_v2.no_show_worker_state
      (singleton, last_run_at, last_successful_run_at, last_today_processed_count, last_historical_processed_count, last_skipped_count, last_error, updated_at)
      values (true, now(), timestamptz '2000-01-01 00:00:00+00', 0, 0, 0, 'old error', now())`);

    await recordNoShowWorkerState({ todayProcessedCount: 2, historicalProcessedCount: 3, skippedCount: 4, error: null });
    const successful = await pool.query<{
      last_successful_run_at: Date | null;
      last_today_processed_count: number;
      last_historical_processed_count: number;
      last_skipped_count: number;
      last_error: string | null;
    }>("select last_successful_run_at, last_today_processed_count, last_historical_processed_count, last_skipped_count, last_error from appointments_v2.no_show_worker_state where singleton = true");
    assert.ok(successful.rows[0]?.last_successful_run_at);
    assert.equal(successful.rows[0]?.last_today_processed_count, 2);
    assert.equal(successful.rows[0]?.last_historical_processed_count, 3);
    assert.equal(successful.rows[0]?.last_skipped_count, 4);
    assert.equal(successful.rows[0]?.last_error, null);

    const successfulAt = successful.rows[0]!.last_successful_run_at!.toISOString();
    await recordNoShowWorkerState({ todayProcessedCount: 0, historicalProcessedCount: 0, skippedCount: 5, error: "synthetic worker failure" });
    const failed = await pool.query<{
      last_successful_run_at: Date | null;
      last_today_processed_count: number;
      last_historical_processed_count: number;
      last_skipped_count: number;
      last_error: string | null;
    }>("select last_successful_run_at, last_today_processed_count, last_historical_processed_count, last_skipped_count, last_error from appointments_v2.no_show_worker_state where singleton = true");
    assert.equal(failed.rows[0]?.last_successful_run_at?.toISOString(), successfulAt);
    assert.equal(failed.rows[0]?.last_today_processed_count, 0);
    assert.equal(failed.rows[0]?.last_historical_processed_count, 0);
    assert.equal(failed.rows[0]?.last_skipped_count, 5);
    assert.equal(failed.rows[0]?.last_error, "synthetic worker failure");
  } finally {
    await pool.query("delete from appointments_v2.no_show_worker_state where singleton = true");
    if (original.rows[0]) {
      const row = original.rows[0] as Record<string, unknown>;
      await pool.query(`insert into appointments_v2.no_show_worker_state
        (singleton, last_run_at, last_successful_run_at, last_today_processed_count, last_historical_processed_count, last_skipped_count, last_error, updated_at)
        values (true, $1, $2, $3, $4, $5, $6, $7)`, [row.last_run_at, row.last_successful_run_at, row.last_today_processed_count, row.last_historical_processed_count, row.last_skipped_count, row.last_error, row.updated_at]);
    }
  }
});
