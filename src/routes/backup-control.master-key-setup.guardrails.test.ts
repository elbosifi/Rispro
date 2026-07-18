import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("Backup V3 master-key setup remains super_admin and recent-reauth protected without exposing a saved key", async () => {
  const source = await fs.readFile(path.join(process.cwd(), "src/routes/backup-control.ts"), "utf8");
  assert.match(source, /backupControlRouter\.use\(requireAnyRole\(\["super_admin"\]\), requireRecentSupervisorReauth\);/);
  assert.match(source, /"\/encryption-setup"/);
  assert.match(source, /"\/encryption-setup\/:setupId\/recovery"/);
  assert.match(source, /"\/encryption-setup\/:setupId\/confirm"/);
  assert.match(source, /backup_master_key_initialized/);
  assert.doesNotMatch(source, /res\.(?:json|status\([^)]*\)\.json)\([^\n]*key/i);
});
