import assert from "node:assert/strict";
import test from "node:test";
import { decryptBackupV3Secret, encryptBackupV3Secret } from "./backup-v3-secret-service.js";

test("Backup V3 secrets encrypt at rest and fail safely after a master-key change", () => {
  const original = process.env.BACKUP_V3_MASTER_KEY;
  try {
    process.env.BACKUP_V3_MASTER_KEY = "test-master-key-one";
    const encrypted = encryptBackupV3Secret("super-secret-value");
    assert.ok(encrypted.startsWith("v1:"));
    assert.doesNotMatch(encrypted, /super-secret-value/);
    assert.equal(decryptBackupV3Secret(encrypted), "super-secret-value");

    process.env.BACKUP_V3_MASTER_KEY = "test-master-key-two";
    assert.throws(() => decryptBackupV3Secret(encrypted), /cannot be decrypted/);
  } finally {
    if (original === undefined) delete process.env.BACKUP_V3_MASTER_KEY;
    else process.env.BACKUP_V3_MASTER_KEY = original;
  }
});

test("Backup V3 secret encryption rejects a missing master key", () => {
  const original = process.env.BACKUP_V3_MASTER_KEY;
  try {
    delete process.env.BACKUP_V3_MASTER_KEY;
    assert.throws(() => encryptBackupV3Secret("value"), /not configured/);
  } finally {
    if (original === undefined) delete process.env.BACKUP_V3_MASTER_KEY;
    else process.env.BACKUP_V3_MASTER_KEY = original;
  }
});
