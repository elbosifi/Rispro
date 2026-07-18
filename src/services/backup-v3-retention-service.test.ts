import assert from "node:assert/strict";
import test from "node:test";
import { normalizeBackupV3RetentionPolicy, planBackupV3Retention } from "./backup-v3-retention-service.js";

function copy(id: string, createdAt: string, verifiedCopyCount = 2) {
  return { copyAttemptId: id, artifactId: `artifact-${id}`, createdAt, remotePath: `/backups/${id}.rispro.zip`, verifiedCopyCount };
}

test("retention preserves newest verified, daily/weekly/monthly representatives, and only verified copies", () => {
  const plan = planBackupV3Retention([
    copy("newest", "2026-07-18T01:00:00.000Z"),
    copy("same-day", "2026-07-18T00:00:00.000Z"),
    copy("yesterday", "2026-07-17T01:00:00.000Z"),
    copy("older-week", "2026-07-01T01:00:00.000Z"),
    copy("only-copy", "2026-06-01T01:00:00.000Z", 1),
    copy("deletable", "2026-05-01T01:00:00.000Z"),
  ], { daily: 2, weekly: 1, monthly: 1 });
  assert.ok(plan.keep.some((item) => item.copyAttemptId === "newest" && item.reason === "newest_verified_copy"));
  assert.ok(plan.keep.some((item) => item.copyAttemptId === "only-copy" && item.reason === "only_verified_copy_for_artifact"));
  assert.deepEqual(plan.delete.map((item) => item.copyAttemptId), ["same-day", "older-week", "deletable"]);
});

test("retention policy presets normalize to documented safe defaults", () => {
  assert.deepEqual(normalizeBackupV3RetentionPolicy({ preset: "7_daily_4_weekly_12_monthly" }), { daily: 7, weekly: 4, monthly: 12 });
  assert.deepEqual(normalizeBackupV3RetentionPolicy({ preset: "14_daily_12_monthly" }), { daily: 14, weekly: 0, monthly: 12 });
  assert.throws(() => normalizeBackupV3RetentionPolicy({ daily: -1 }), /whole numbers/);
});
