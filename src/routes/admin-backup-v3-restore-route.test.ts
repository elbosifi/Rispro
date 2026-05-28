import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function adminRouteSource(): Promise<string> {
  return fs.readFile(path.join(process.cwd(), "src/routes/admin.ts"), "utf8");
}

async function combinedRestoreSource(): Promise<string> {
  return [
    await adminRouteSource(),
    await fs.readFile(path.join(process.cwd(), "src/services/backup-v3-upload.ts"), "utf8"),
    await fs.readFile(path.join(process.cwd(), "src/services/backup-v3-full-restore.ts"), "utf8"),
  ].join("\n");
}

test("v3 full restore endpoint is disabled by default and requires release flag", async () => {
  const source = await combinedRestoreSource();
  assert.match(source, /"\/restore\/v3"/);
  assert.match(source, /process\.env\.RESTORE_V3_FULL_ENABLED !== "true"/);
  assert.match(source, /V3 full restore is disabled by configuration/);
});

test("v3 restore status endpoint reports flags and capability without upload or mutation", async () => {
  const source = await adminRouteSource();
  assert.match(source, /"\/restore\/v3\/status"/);
  assert.match(source, /method: "GET"|adminRouter\.get\(/);
  assert.match(source, /enabled = process\.env\.RESTORE_V3_FULL_ENABLED === "true"/);
  assert.match(source, /dbOnlyEnabled = process\.env\.RESTORE_V3_DB_ONLY_ENABLED === "true"/);
  assert.match(source, /requiresSuperAdmin: true/);
  assert.match(source, /userCanExecute/);
  assert.match(source, /recentReauthRequired: true/);
  assert.match(source, /recentReauthSatisfied/);
  assert.match(source, /confirmationText: "RESTORE RISPRO"/);
  assert.match(source, /acceptedArchiveExtensions: \["\.rispro\.zip"\]/);
  assert.match(source, /disabledReason/);
  assert.doesNotMatch(source.match(/"\/restore\/v3\/status"[\s\S]*?\n\);/)?.[0] || "", /stageBackupV3MultipartUpload|restoreBackupV3FullService|restoreBackupSnapshot/);
});

test("v3 restore status documents disabled, enabled, non-super_admin, and reauth states", async () => {
  const source = await adminRouteSource();
  assert.match(source, /!enabled[\s\S]*V3 full restore is disabled by configuration/);
  assert.match(source, /!userCanExecute[\s\S]*requires super_admin/);
  assert.match(source, /!recentReauthSatisfied[\s\S]*Recent supervisor re-authentication is required/);
  assert.match(source, /req\.user\?\.role === "super_admin"/);
});

test("v3 full restore flag endpoints are super_admin-only and POST requires recent reauth", async () => {
  const source = await adminRouteSource();
  assert.match(source, /"\/restore\/v3\/flag",\s*\n\s*requireAnyRole\(\["super_admin"\]\)/);
  assert.match(source, /getBackupV3RestoreFlagStatus\(\)/);
  assert.match(source, /adminRouter\.use\(requireRecentSupervisorReauth\)[\s\S]*"\/restore\/v3\/flag"[\s\S]*updateBackupV3RestoreFlag\(body\.enabled\)/);
  assert.match(source, /typeof body\.enabled !== "boolean"/);
});

test("v3 full restore endpoint requires super_admin, confirmation, passphrase, and archive upload", async () => {
  const source = await combinedRestoreSource();
  assert.match(source, /"\/restore\/v3",\s*\n\s*requireAnyRole\(\["super_admin"\]\)/);
  assert.match(source, /stageBackupV3MultipartUpload\(req, "rispro-restore-v3-full-"\)/);
  assert.match(source, /requireBackupV3RestoreConfirmation\(staged\.confirmation\)/);
  assert.match(source, /Backup passphrase is required/);
  assert.match(source, /A backup archive file is required/);
});

test("v3 full restore endpoint calls orchestration only after gates and cleans staged upload", async () => {
  const source = await adminRouteSource();
  assert.match(
    source,
    /RESTORE_V3_FULL_ENABLED[\s\S]*stageBackupV3MultipartUpload[\s\S]*requireBackupV3RestoreConfirmation[\s\S]*Backup passphrase is required[\s\S]*restoreBackupV3FullService/
  );
  assert.match(source, /cleanupBackupV3StagedUpload\(staged\)/);
});

test("v3 full restore response is orchestration result and does not add secret values", async () => {
  const source = await adminRouteSource();
  assert.match(source, /const result = await restoreBackupV3FullService/);
  assert.match(source, /res\.json\(result\)/);
  assert.doesNotMatch(source, /DATABASE_URL.*res\.json|JWT_SECRET.*res\.json|passphrase.*res\.json/);
});

test("db-only endpoint remains experimental and disabled unless explicitly flagged", async () => {
  const source = await combinedRestoreSource();
  assert.match(source, /"\/restore\/v3\/db-only"/);
  assert.match(source, /process\.env\.RESTORE_V3_DB_ONLY_ENABLED !== "true"/);
  assert.match(source, /V3 DB-only restore is experimental and disabled by configuration/);
  assert.match(source, /restoreIncomplete: true/);
});

test("v2 restore behavior remains unchanged", async () => {
  const source = await adminRouteSource();
  assert.match(source, /"\/restore",\s*\n\s*express\.json\(\{ limit: "500mb" \}\)/);
  assert.match(source, /restoreBackupSnapshot\(body\.backup, req\.user!\.sub, body\.passphrase, body\.confirmation\)/);
});
