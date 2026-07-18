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
  recoverBackupV3MasterKey,
} from "./backup-v3-master-key-setup-service.js";
import { backupV3MasterKeyMaterial } from "./backup-v3-secret-service.js";
import crypto from "node:crypto";

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
    const noSecrets = { representativeEncryptedValue: async () => null };
    const initial = await getBackupV3MasterKeyStatus(envPath, noSecrets);
    assert.deepEqual(initial, { state: "fresh_setup_required", encryptionReady: false, setupRequired: true, restartRequired: false, setupAvailable: true });

    const started = await beginBackupV3MasterKeySetup("super-admin-1", envPath, noSecrets);
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
    assert.deepEqual(await getBackupV3MasterKeyStatus(envPath, noSecrets), { state: "restart_required", encryptionReady: false, setupRequired: false, restartRequired: true, setupAvailable: false });
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
    const noSecrets = { representativeEncryptedValue: async () => null };
    const started = await beginBackupV3MasterKeySetup("super-admin-1", envPath, noSecrets);
    await assert.rejects(() => confirmBackupV3MasterKeySetup(started.setupId, "super-admin-1", envPath), /Download and save/);
    consumeBackupV3MasterKeyRecovery(started.setupId, "super-admin-1");
    await confirmBackupV3MasterKeySetup(started.setupId, "super-admin-1", envPath);
    await assert.rejects(() => beginBackupV3MasterKeySetup("super-admin-1", envPath, noSecrets), /already contains encrypted backup credentials|already configured/);
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

test("Backup V3 recovery validates a historical key before saving and rejects an incorrect key", async () => {
  const original = process.env.BACKUP_V3_MASTER_KEY;
  delete process.env.BACKUP_V3_MASTER_KEY;
  const { dir, envPath } = await tempEnv();
  const correctKey = crypto.randomBytes(32).toString("base64url");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", backupV3MasterKeyMaterial(correctKey), iv);
  const encrypted = Buffer.concat([cipher.update("credential", "utf8"), cipher.final()]);
  const payload = `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${encrypted.toString("base64")}`;
  try {
    await assert.rejects(() => recoverBackupV3MasterKey(crypto.randomBytes(32).toString("base64url"), envPath, { representativeEncryptedValue: async () => payload }), /cannot decrypt/);
    await recoverBackupV3MasterKey(`BACKUP_V3_MASTER_KEY=${correctKey}`, envPath, { representativeEncryptedValue: async () => payload });
    const content = await fs.readFile(envPath, "utf8");
    assert.match(content, new RegExp(`^BACKUP_V3_MASTER_KEY=${correctKey}$`, "m"));
  } finally {
    if (original === undefined) delete process.env.BACKUP_V3_MASTER_KEY;
    else process.env.BACKUP_V3_MASTER_KEY = original;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
