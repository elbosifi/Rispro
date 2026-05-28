import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { getBackupV3RestoreFlagStatus, updateBackupV3RestoreFlag } from "./backup-v3-restore-flag-service.js";

async function tempEnv(content: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-restore-flag-"));
  const envPath = path.join(dir, ".env");
  await fs.writeFile(envPath, content, "utf8");
  return envPath;
}

test("restore v3 flag status defaults false when key is absent", async () => {
  const originalRuntime = process.env.RESTORE_V3_FULL_ENABLED;
  process.env.RESTORE_V3_FULL_ENABLED = "false";
  try {
    const envPath = await tempEnv("DATABASE_URL=postgres://local\n");
    assert.deepEqual(await getBackupV3RestoreFlagStatus(envPath), {
      enabledInEnvFile: false,
      enabledInRuntime: false,
      restartRequired: false,
    });
  } finally {
    if (originalRuntime === undefined) delete process.env.RESTORE_V3_FULL_ENABLED;
    else process.env.RESTORE_V3_FULL_ENABLED = originalRuntime;
  }
});

test("restore v3 flag update changes only RESTORE_V3_FULL_ENABLED and preserves unrelated env entries", async () => {
  const originalRuntime = process.env.RESTORE_V3_FULL_ENABLED;
  process.env.RESTORE_V3_FULL_ENABLED = "false";
  try {
    const envPath = await tempEnv("DATABASE_URL=postgres://secret\nPORT=5000\nRESTORE_V3_FULL_ENABLED=false\nJWT_SECRET=keep-me\n");
    const result = await updateBackupV3RestoreFlag(true, envPath);
    const next = await fs.readFile(envPath, "utf8");

    assert.match(next, /^DATABASE_URL=postgres:\/\/secret$/m);
    assert.match(next, /^PORT=5000$/m);
    assert.match(next, /^JWT_SECRET=keep-me$/m);
    assert.match(next, /^RESTORE_V3_FULL_ENABLED=true$/m);
    assert.equal(result.enabledInEnvFile, true);
    assert.equal(result.enabledInRuntime, false);
    assert.equal(result.restartRequired, true);
  } finally {
    if (originalRuntime === undefined) delete process.env.RESTORE_V3_FULL_ENABLED;
    else process.env.RESTORE_V3_FULL_ENABLED = originalRuntime;
  }
});

test("restore v3 flag update creates a safety backup before writing", async () => {
  const envPath = await tempEnv("RESTORE_V3_FULL_ENABLED=false\nUNCHANGED=value\n");
  const result = await updateBackupV3RestoreFlag(true, envPath);
  const backup = await fs.readFile(result.safetyBackupPath, "utf8");

  assert.match(path.basename(result.safetyBackupPath), /^\.env\.restore-v3-full-flag\./);
  assert.equal(backup, "RESTORE_V3_FULL_ENABLED=false\nUNCHANGED=value\n");
});
