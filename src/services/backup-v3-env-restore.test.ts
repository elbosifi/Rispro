import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import dotenv from "dotenv";
import { encryptBackupV3EnvPayload, type BackupV3EncryptedEnvBundle } from "./backup-v3-env.js";
import { restoreBackupV3EnvOnly } from "./backup-v3-env-restore.js";

const PASSPHRASE = "correct-passphrase";

async function writeEnvBundle(
  tempDir: string,
  variables: Record<string, string>,
  mutate?: (bundle: BackupV3EncryptedEnvBundle) => BackupV3EncryptedEnvBundle
): Promise<string> {
  const stagingDir = path.join(tempDir, "staged");
  const bundle = encryptBackupV3EnvPayload({ createdAt: "2026-05-27T00:00:00.000Z", variables }, PASSPHRASE);
  await fs.mkdir(path.join(stagingDir, "config"), { recursive: true });
  await fs.writeFile(path.join(stagingDir, "config", "env.enc.json"), JSON.stringify(mutate ? mutate(bundle) : bundle));
  return stagingDir;
}

async function readEnvValues(envPath: string): Promise<Record<string, string>> {
  return dotenv.parse(await fs.readFile(envPath, "utf8"));
}

test("restoreBackupV3EnvOnly restores valid encrypted env bundle and requires restart", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-env-restore-"));
  const envPath = path.join(tempDir, ".env");
  await fs.writeFile(envPath, "DATABASE_URL=old\nLOCAL_ONLY=keep\n");
  const stagingDir = await writeEnvBundle(tempDir, {
    DATABASE_URL: "postgres://new",
    JWT_SECRET: "secret-value",
  });

  const result = await restoreBackupV3EnvOnly({ stagingDir, passphrase: PASSPHRASE, envPath });
  const values = await readEnvValues(envPath);

  assert.equal(result.envRestored, true);
  assert.equal(result.restartRequired, true);
  assert.equal(result.dbRestored, false);
  assert.equal(result.storageRestored, false);
  assert.equal(result.externalDocumentsRestored, false);
  assert.equal(values.DATABASE_URL, "postgres://new");
  assert.equal(values.JWT_SECRET, "secret-value");
  assert.equal(values.LOCAL_ONLY, "keep");
});

test("wrong passphrase, unsupported env encryption, and malformed metadata reject before write", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-env-restore-"));
  const envPath = path.join(tempDir, ".env");
  await fs.writeFile(envPath, "DATABASE_URL=old\n");
  const stagingDir = await writeEnvBundle(tempDir, { DATABASE_URL: "new" });

  await assert.rejects(
    () => restoreBackupV3EnvOnly({ stagingDir, passphrase: "wrong-passphrase", envPath }),
    /Could not decrypt/
  );
  assert.equal((await readEnvValues(envPath)).DATABASE_URL, "old");

  const unsupported = await writeEnvBundle(tempDir, { DATABASE_URL: "new" }, (bundle) => ({
    ...bundle,
    cipher: "unsupported" as BackupV3EncryptedEnvBundle["cipher"],
  }));
  await assert.rejects(
    () => restoreBackupV3EnvOnly({ stagingDir: unsupported, passphrase: PASSPHRASE, envPath }),
    /Could not decrypt/
  );
  assert.equal((await readEnvValues(envPath)).DATABASE_URL, "old");

  const unsupportedKdf = await writeEnvBundle(tempDir, { DATABASE_URL: "new" }, (bundle) => ({
    ...bundle,
    kdf: "unsupported" as BackupV3EncryptedEnvBundle["kdf"],
  }));
  await assert.rejects(
    () => restoreBackupV3EnvOnly({ stagingDir: unsupportedKdf, passphrase: PASSPHRASE, envPath }),
    /Could not decrypt/
  );
  assert.equal((await readEnvValues(envPath)).DATABASE_URL, "old");

  const malformed = await writeEnvBundle(tempDir, { DATABASE_URL: "new" }, (bundle) => ({
    ...bundle,
    iv: "not-base64",
  }));
  await assert.rejects(
    () => restoreBackupV3EnvOnly({ stagingDir: malformed, passphrase: PASSPHRASE, envPath }),
    /Could not decrypt/
  );
  assert.equal((await readEnvValues(envPath)).DATABASE_URL, "old");
});

test("malformed env key rejects before write", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-env-restore-"));
  const envPath = path.join(tempDir, ".env");
  await fs.writeFile(envPath, "DATABASE_URL=old\n");
  const stagingDir = await writeEnvBundle(tempDir, { "BAD-NAME": "new" });

  await assert.rejects(
    () => restoreBackupV3EnvOnly({ stagingDir, passphrase: PASSPHRASE, envPath }),
    /malformed env variable name/
  );
  assert.equal((await readEnvValues(envPath)).DATABASE_URL, "old");
});

test("only RISpro-managed keys are restored and unrelated local keys are preserved", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-env-restore-"));
  const envPath = path.join(tempDir, ".env");
  await fs.writeFile(envPath, "DATABASE_URL=old\nLOCAL_ONLY=keep\nUNMANAGED_BACKUP_KEY=local\nNODE_ENV=production\nPORT=3000\n");
  const stagingDir = await writeEnvBundle(tempDir, {
    DATABASE_URL: "new",
    UNMANAGED_BACKUP_KEY: "from-backup",
    NODE_ENV: "development",
    PORT: "9999",
  });

  const result = await restoreBackupV3EnvOnly({ stagingDir, passphrase: PASSPHRASE, envPath });
  const values = await readEnvValues(envPath);

  assert.equal(values.DATABASE_URL, "new");
  assert.equal(values.LOCAL_ONLY, "keep");
  assert.equal(values.UNMANAGED_BACKUP_KEY, "local");
  assert.equal(values.NODE_ENV, "production");
  assert.equal(values.PORT, "3000");
  assert.deepEqual(result.ignoredArchiveKeys, ["NODE_ENV", "PORT", "UNMANAGED_BACKUP_KEY"]);
  assert.deepEqual(result.preservedLocalKeys.map((entry) => entry.name), ["LOCAL_ONLY", "NODE_ENV", "PORT", "UNMANAGED_BACKUP_KEY"]);
});

test("secret values are masked in restore result", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-env-restore-"));
  const envPath = path.join(tempDir, ".env");
  const stagingDir = await writeEnvBundle(tempDir, {
    DATABASE_URL: "postgres://secret",
    JWT_SECRET: "jwt-secret-value",
    COOKIE_NAME: "rispro_session",
  });

  const result = await restoreBackupV3EnvOnly({ stagingDir, passphrase: PASSPHRASE, envPath });
  const serialized = JSON.stringify(result);

  assert.doesNotMatch(serialized, /postgres:\/\/secret|jwt-secret-value/);
  assert.match(serialized, /\*{8}/);
  assert.deepEqual(result.envVarsRestored.map((entry) => entry.name), ["COOKIE_NAME", "DATABASE_URL", "JWT_SECRET"]);
});

test("quoted, empty, and multiline values are written safely", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-env-restore-"));
  const envPath = path.join(tempDir, ".env");
  const stagingDir = await writeEnvBundle(tempDir, {
    DATABASE_URL: "postgres://user:p a#s\"s\\word@host/db?ssl=$true",
    JWT_SECRET: "",
    ORTHANC_PASSWORD: "line1\nline2",
  });

  await restoreBackupV3EnvOnly({ stagingDir, passphrase: PASSPHRASE, envPath });
  const raw = await fs.readFile(envPath, "utf8");
  const values = dotenv.parse(raw);

  assert.match(raw, /^DATABASE_URL=['"`]/m);
  assert.match(raw, /^JWT_SECRET=""/m);
  assert.match(raw, /^ORTHANC_PASSWORD=['"`]/m);
  assert.equal(values.DATABASE_URL, "postgres://user:p a#s\"s\\word@host/db?ssl=$true");
  assert.equal(values.JWT_SECRET, "");
  assert.equal(values.ORTHANC_PASSWORD, "line1\nline2");
});

test("missing existing .env creates a new file safely", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-env-restore-"));
  const envPath = path.join(tempDir, ".env");
  const stagingDir = await writeEnvBundle(tempDir, { DATABASE_URL: "postgres://new" });

  const result = await restoreBackupV3EnvOnly({ stagingDir, passphrase: PASSPHRASE, envPath });

  assert.equal((await readEnvValues(envPath)).DATABASE_URL, "postgres://new");
  assert.equal(result.safetyBackupPath, null);
});

test("write failure before rename leaves existing .env unchanged and creates safety backup first", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-env-restore-"));
  const envPath = path.join(tempDir, ".env");
  await fs.writeFile(envPath, "DATABASE_URL=old\n");
  const stagingDir = await writeEnvBundle(tempDir, { DATABASE_URL: "new" });

  await assert.rejects(
    () => restoreBackupV3EnvOnly({ stagingDir, passphrase: PASSPHRASE, envPath, failBeforeRename: true }),
    /Injected env restore failure/
  );

  assert.equal((await readEnvValues(envPath)).DATABASE_URL, "old");
  const safetyBackups = (await fs.readdir(tempDir)).filter((name) => name.startsWith(".env.pre-restore-"));
  assert.equal(safetyBackups.length, 1);
  assert.equal(await fs.readFile(path.join(tempDir, safetyBackups[0]!), "utf8"), "DATABASE_URL=old\n");
});

test("provided safety backup path is returned without exposing secrets", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-env-restore-"));
  const envPath = path.join(tempDir, ".env");
  await fs.writeFile(envPath, "DATABASE_URL=old\n");
  const stagingDir = await writeEnvBundle(tempDir, { DATABASE_URL: "postgres://new-secret" });
  const safetyBackupPath = path.join(tempDir, ".env.pre-created");

  const result = await restoreBackupV3EnvOnly({ stagingDir, passphrase: PASSPHRASE, envPath, safetyBackupPath });

  assert.equal(result.safetyBackupPath, safetyBackupPath);
  assert.doesNotMatch(JSON.stringify(result), /new-secret/);
});

test("DB, storage, external documents, and v2 restore behavior are not touched", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "rispro-env-restore-"));
  const envPath = path.join(tempDir, ".env");
  const dbMarker = path.join(tempDir, "db-marker.txt");
  const storageMarker = path.join(tempDir, "storage", "file.txt");
  const documentMarker = path.join(tempDir, "documents", "file.txt");
  await fs.mkdir(path.dirname(storageMarker), { recursive: true });
  await fs.mkdir(path.dirname(documentMarker), { recursive: true });
  await fs.writeFile(dbMarker, "db");
  await fs.writeFile(storageMarker, "storage");
  await fs.writeFile(documentMarker, "documents");
  const stagingDir = await writeEnvBundle(tempDir, { DATABASE_URL: "postgres://new" });

  await restoreBackupV3EnvOnly({ stagingDir, passphrase: PASSPHRASE, envPath });

  assert.equal(await fs.readFile(dbMarker, "utf8"), "db");
  assert.equal(await fs.readFile(storageMarker, "utf8"), "storage");
  assert.equal(await fs.readFile(documentMarker, "utf8"), "documents");
  const source = await fs.readFile(path.join(process.cwd(), "src/routes/admin.ts"), "utf8");
  assert.match(source, /"\/restore\/v3"/);
  assert.match(source, /V3 DB-only restore is experimental and disabled by configuration/);
  assert.match(source, /"\/restore",[\s\S]*express\.json\(\{ limit: "500mb" \}\)/);
  assert.match(source, /restoreBackupSnapshot\(body\.backup, req\.user!\.sub, body\.passphrase, body\.confirmation\)/);
});
