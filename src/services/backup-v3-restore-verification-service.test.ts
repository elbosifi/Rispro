import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getBackupV3RestoreVerificationEnvironment, verifyBackupV3Restore, type BackupV3RestoreVerificationDependencies } from "./backup-v3-restore-verification-service.js";
import type { BackupV3Manifest } from "./backup-v3-types.js";

const manifest = {
  formatVersion: 3,
  app: { name: "rispro", packageVersion: "1", gitCommit: null },
  createdAt: "2026-07-18T00:00:00.000Z",
  initiatedByUserId: null,
  database: { schemas: ["public"], migrationVersion: "127", tables: [{ schema: "public", name: "users", archivePath: "database/tables/public.users.json", rowCount: 2, columns: [] }] },
  storageRoots: [], archiveEntries: [{ archivePath: "database/postgresql.dump", byteSize: 10, sha256: "a" }], postgresDump: { archivePath: "database/postgresql.dump", byteSize: 10, sha256: "a", format: "custom" }, files: [], env: { archivePath: "config/env.enc.json", variableNames: [] }, safetyBackup: { preferredMethod: "pg_dump_custom", fallbackMethod: "v3_snapshot" }, limits: { maxFiles: 60000, maxFileBytes: 3, maxTotalUncompressedBytes: 3 },
} as unknown as BackupV3Manifest;

test("restore verification uses only the supplied disposable targets and cleans its staging directory", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-restore-verify-test-"));
  const archive = path.join(tempDir, "backup.rispro.zip");
  await fs.writeFile(archive, "archive");
  const calls: string[] = [];
  let stagingDir = "";
  const dependencies: BackupV3RestoreVerificationDependencies = {
    async validateArchive(input) { stagingDir = input.stagingDir; calls.push("validate"); return manifest; },
    async restoreDatabase(dump, databaseUrl) { calls.push(`restore:${path.basename(dump)}:${databaseUrl}`); },
    async verifyDatabase() { calls.push("database"); return { tables: 1, rows: 2 }; },
    async restoreAndVerifyFiles() { calls.push("files"); return 0; },
  };
  try {
    const result = await verifyBackupV3Restore({ archivePath: archive, expectedSha256: "not-used-by-mock", passphrase: "safe-passphrase", environment: { databaseUrl: "postgresql://verify:verify@verify-db:5432/rispro_restore_verify", storageRoot: path.join(tempDir, "restore-verify") } }, dependencies);
    assert.deepEqual(calls, ["validate", "restore:postgresql.dump:postgresql://verify:verify@verify-db:5432/rispro_restore_verify", "database", "files"]);
    assert.equal(result.ok, true);
    await assert.rejects(() => fs.stat(stagingDir));
  } finally { await fs.rm(tempDir, { recursive: true, force: true }); }
});

test("restore verification environment rejects production database and non-dedicated storage targets", () => {
  const oldDatabase = process.env.BACKUP_V3_RESTORE_VERIFY_DATABASE_URL;
  const oldStorage = process.env.BACKUP_V3_RESTORE_VERIFY_STORAGE_ROOT;
  try {
    process.env.BACKUP_V3_RESTORE_VERIFY_DATABASE_URL = process.env.DATABASE_URL;
    process.env.BACKUP_V3_RESTORE_VERIFY_STORAGE_ROOT = path.join(process.cwd(), "storage", "restore-verify");
    assert.throws(() => getBackupV3RestoreVerificationEnvironment(), /dedicated disposable database/);
    process.env.BACKUP_V3_RESTORE_VERIFY_DATABASE_URL = "postgresql://verify:verify@verify-db:5432/rispro_restore_verify";
    process.env.BACKUP_V3_RESTORE_VERIFY_STORAGE_ROOT = path.join(process.cwd(), "storage", "uploads");
    assert.throws(() => getBackupV3RestoreVerificationEnvironment(), /dedicated disposable path/);
  } finally {
    if (oldDatabase === undefined) delete process.env.BACKUP_V3_RESTORE_VERIFY_DATABASE_URL; else process.env.BACKUP_V3_RESTORE_VERIFY_DATABASE_URL = oldDatabase;
    if (oldStorage === undefined) delete process.env.BACKUP_V3_RESTORE_VERIFY_STORAGE_ROOT; else process.env.BACKUP_V3_RESTORE_VERIFY_STORAGE_ROOT = oldStorage;
  }
});
