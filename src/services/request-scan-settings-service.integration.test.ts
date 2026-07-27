import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "../db/pool.js";
import {
  readRequestScanSettings,
  readRequestScanSettingsForDisplay,
  resolveRequestScanSettingsForTest,
  saveRequestScanSettings,
} from "./request-scan-settings-service.js";

test.after(async () => {
  await pool.end();
});

test("resolves submitted request-scan test settings without saving them", async (t) => {
  try {
    await pool.query("select 1");
  } catch {
    t.skip("PostgreSQL is not reachable at configured DATABASE_URL.");
    return;
  }

  const settings = await resolveRequestScanSettingsForTest({
    enabled: true,
    server: "draft-smb-server",
    share: "draft-share",
    domain: "DRAFT",
    username: "draft-user",
    password: "draft-password",
    incomingSubfolder: "Draft/Incoming",
    processedSubfolder: "Draft/Processed",
    failedSubfolder: "Draft/Failed",
    modalityDocumentsRootSubfolder: "ModalityDocuments",
    pollingIntervalSeconds: 30,
    fileReadyDelaySeconds: 20,
  });

  assert.deepEqual(settings, {
    enabled: true,
    server: "draft-smb-server",
    share: "draft-share",
    domain: "DRAFT",
    username: "draft-user",
    password: "draft-password",
    incomingSubfolder: "Draft/Incoming",
    processedSubfolder: "Draft/Processed",
    failedSubfolder: "Draft/Failed",
    modalityDocumentsRootSubfolder: "ModalityDocuments",
    pollingIntervalSeconds: 30,
    fileReadyDelaySeconds: 20,
  });
});

test("saves the request-scan SMB password without the Backup V3 master key", async (t) => {
  try {
    await pool.query("select 1");
  } catch {
    t.skip("PostgreSQL is not reachable at configured DATABASE_URL.");
    return;
  }

  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const user = await pool.query<{ id: number }>(
    `insert into users (username, full_name, password_hash, role, is_active)
     values ($1, $2, 'test', 'supervisor', true)
     returning id`,
    [`request_scan_settings_${suffix}`, `Request Scan Settings ${suffix}`]
  );
  const userId = Number(user.rows[0]?.id);
  const previousSettings = await pool.query<{ setting_key: string; setting_value: unknown; updated_by_user_id: number | null }>(
    `select setting_key, setting_value, updated_by_user_id
     from system_settings
     where category = 'request_scan_automation'`
  );
  const previousMasterKey = process.env.BACKUP_V3_MASTER_KEY;
  delete process.env.BACKUP_V3_MASTER_KEY;

  try {
    await saveRequestScanSettings({
      enabled: true,
      server: "test-server",
      share: "test-share",
      domain: "",
      username: "test-user",
      password: "ordinary-request-scan-password",
      incomingSubfolder: "Requests/Incoming",
      processedSubfolder: "Requests/Processed",
      failedSubfolder: "Requests/Failed",
      pollingIntervalSeconds: 15,
      fileReadyDelaySeconds: 15,
    }, userId);

    const stored = await pool.query<{ setting_value: { value: string } }>(
      `select setting_value from system_settings
       where category = 'request_scan_automation' and setting_key = 'password'`
    );
    assert.deepEqual(stored.rows[0]?.setting_value, { value: "ordinary-request-scan-password" });
    assert.equal((await readRequestScanSettings()).password, "ordinary-request-scan-password");
    assert.equal((await readRequestScanSettingsForDisplay()).passwordConfigured, true);
  } finally {
    if (previousMasterKey === undefined) delete process.env.BACKUP_V3_MASTER_KEY;
    else process.env.BACKUP_V3_MASTER_KEY = previousMasterKey;
    await pool.query("delete from audit_log where entity_type = 'system_setting' and changed_by_user_id = $1", [userId]).catch(() => undefined);
    await pool.query("delete from system_settings where category = 'request_scan_automation'");
    for (const setting of previousSettings.rows) {
      await pool.query(
        `insert into system_settings (category, setting_key, setting_value, updated_by_user_id)
         values ('request_scan_automation', $1, $2::jsonb, $3)`,
        [setting.setting_key, JSON.stringify(setting.setting_value), setting.updated_by_user_id]
      );
    }
    await pool.query("delete from users where id = $1", [userId]).catch(() => undefined);
  }
});
