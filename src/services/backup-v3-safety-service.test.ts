import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

process.env.DATABASE_URL ||= "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET ||= "test-secret";

const {
  acquireBackupV3RestoreLock,
  requireBackupV3RestoreConfirmation,
  selectBackupV3DbSafetyMethod,
} = await import("./backup-v3-safety-service.js");

test("requireBackupV3RestoreConfirmation requires exact restore confirmation", () => {
  assert.doesNotThrow(() => requireBackupV3RestoreConfirmation("RESTORE RISPRO"));
  assert.throws(() => requireBackupV3RestoreConfirmation("restore"), /Confirmation must be RESTORE RISPRO/);
});

test("acquireBackupV3RestoreLock uses the v3 advisory lock key", async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const fakeClient = {
    async query(sql: string, values: unknown[]) {
      calls.push({ sql, values });
      return { rows: [{ locked: true }] };
    },
  };

  await acquireBackupV3RestoreLock(fakeClient as never);

  assert.match(calls[0]!.sql, /pg_try_advisory_lock/);
  assert.deepEqual(calls[0]!.values, ["rispro_restore_v3"]);
});

test("selectBackupV3DbSafetyMethod prefers pg_dump and falls back to v3 snapshot", () => {
  assert.equal(selectBackupV3DbSafetyMethod(true), "pg_dump_custom");
  assert.equal(selectBackupV3DbSafetyMethod(false), "v3_snapshot");
});

test("v3 restore skeleton route does not contain destructive restore operations", async () => {
  const adminRoute = await fs.readFile(path.join(process.cwd(), "src/routes/admin.ts"), "utf8");
  const safetyService = await fs.readFile(path.join(process.cwd(), "src/services/backup-v3-safety-service.ts"), "utf8");
  const combined = `${adminRoute}\n${safetyService}`;

  assert.match(adminRoute, /"\/restore\/v3\/db-only"/);
  assert.match(adminRoute, /V3 DB-only restore is experimental and disabled by configuration/);
  assert.match(adminRoute, /RESTORE_V3_DB_ONLY_ENABLED/);
  assert.match(adminRoute, /runBackupV3DatabaseRestoreOnly/);
  assert.match(adminRoute, /previewBackupV3RestoreFromArchive[\s\S]*runBackupV3DatabaseRestoreOnly/);
  assert.match(combined, /pg_dump", \["-Fc"/);
  assert.match(combined, /pgDumpConnectionEnv\(env\.databaseUrl\)/);
  assert.match(combined, /streamBackupV3Archive/);
  assert.match(combined, /copyEnvSafety/);
  assert.match(combined, /copyStorageSafety/);
  assert.match(combined, /restoreIncomplete: true/);
  assert.match(combined, /storageRestored: false/);
  assert.match(combined, /envRestored: false/);
  assert.doesNotMatch(combined, /truncate table/i);
  assert.doesNotMatch(combined, /insertRows/);
  assert.doesNotMatch(combined, /restoreDocumentFiles/);
  assert.doesNotMatch(combined, /writeRestoredEnvFile/);
});
