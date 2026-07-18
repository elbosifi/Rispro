import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  beginBackupV3MasterKeySetup,
  confirmBackupV3MasterKeySetup,
  consumeBackupV3MasterKeyRecovery,
  getBackupV3MasterKeyStatus,
} from "./backup-v3-master-key-setup-service.js";

async function tempEnv(): Promise<{ dir: string; envPath: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-backup-key-"));
  return { dir, envPath: path.join(dir, ".env") };
}

test("Backup V3 key setup reports missing encryption, preserves env values, and saves only a server-generated key", async () => {
  const original = process.env.BACKUP_V3_MASTER_KEY;
  delete process.env.BACKUP_V3_MASTER_KEY;
  const { dir, envPath } = await tempEnv();
  try {
    await fs.writeFile(envPath, "NODE_ENV=production\nUNRELATED_VALUE=keep-me\n", "utf8");
    const initial = await getBackupV3MasterKeyStatus(envPath);
    assert.deepEqual(initial, { encryptionReady: false, setupRequired: true, restartRequired: false, setupAvailable: true });

    const started = await beginBackupV3MasterKeySetup("super-admin-1", envPath);
    assert.equal(Object.hasOwn(started, "key"), false);
    assert.equal(JSON.stringify(started).includes("BACKUP_V3_MASTER_KEY"), false);
    const recovery = consumeBackupV3MasterKeyRecovery(started.setupId, "super-admin-1", "test-installation");
    const key = recovery.match(/^BACKUP_V3_MASTER_KEY=([^\n]+)$/m)?.[1] || "";
    assert.match(key, /^[A-Za-z0-9_-]{43}$/);
    assert.throws(() => consumeBackupV3MasterKeyRecovery(started.setupId, "super-admin-1"), /already downloaded/);

    const saved = await confirmBackupV3MasterKeySetup(started.setupId, "super-admin-1", envPath);
    assert.deepEqual(saved, { restartRequired: true });
    assert.equal(JSON.stringify(saved).includes(key), false);
    const content = await fs.readFile(envPath, "utf8");
    assert.match(content, /^NODE_ENV=production$/m);
    assert.match(content, /^UNRELATED_VALUE=keep-me$/m);
    assert.match(content, /^BACKUP_V3_MASTER_KEY=[A-Za-z0-9_-]{43}$/m);
    const entries = await fs.readdir(dir);
    assert.ok(entries.some((entry) => entry.startsWith(".env.backup-v3-master-key.") && entry.endsWith(".bak")));
    assert.equal(entries.some((entry) => entry.endsWith(".tmp")), false);
    assert.deepEqual(await getBackupV3MasterKeyStatus(envPath), { encryptionReady: false, setupRequired: false, restartRequired: true, setupAvailable: false });
  } finally {
    if (original === undefined) delete process.env.BACKUP_V3_MASTER_KEY;
    else process.env.BACKUP_V3_MASTER_KEY = original;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("Backup V3 key setup refuses confirmation before recovery and never replaces an existing configured key", async () => {
  const original = process.env.BACKUP_V3_MASTER_KEY;
  delete process.env.BACKUP_V3_MASTER_KEY;
  const { dir, envPath } = await tempEnv();
  try {
    const started = await beginBackupV3MasterKeySetup("super-admin-1", envPath);
    await assert.rejects(() => confirmBackupV3MasterKeySetup(started.setupId, "super-admin-1", envPath), /Download and save/);
    consumeBackupV3MasterKeyRecovery(started.setupId, "super-admin-1");
    await confirmBackupV3MasterKeySetup(started.setupId, "super-admin-1", envPath);
    await assert.rejects(() => beginBackupV3MasterKeySetup("super-admin-1", envPath), /already configured/);
  } finally {
    if (original === undefined) delete process.env.BACKUP_V3_MASTER_KEY;
    else process.env.BACKUP_V3_MASTER_KEY = original;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("Backup V3 setup implementation uses cryptographic random generation and atomic rename", async () => {
  const source = await fs.readFile(path.join(process.cwd(), "src/services/backup-v3-master-key-setup-service.ts"), "utf8");
  assert.match(source, /crypto\.randomBytes\(32\)/);
  assert.match(source, /await fs\.rename\(temporaryPath, envPath\)/);
  assert.match(source, /await writeSynced\(safetyPath, existing, true\)/);
});
