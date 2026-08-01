import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "../db/pool.js";
import { readAuthoritativeOrthancSettings, readAuthoritativeOrthancSettingsForDisplay, saveAuthoritativeOrthancSettings } from "./authoritative-orthanc-service.js";

test.after(async () => { await pool.end(); });

test("defaults automatic document export to enabled, persists explicit false, and hides the password", async (t) => {
  try { await pool.query("select 1"); } catch { t.skip("PostgreSQL is not reachable at configured DATABASE_URL."); return; }
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const user = await pool.query<{ id: number }>("insert into users(username,full_name,password_hash,role,is_active) values($1,$1,'test','super_admin',true) returning id", [`orthanc_auto_export_${suffix}`]);
  const userId = Number(user.rows[0]!.id);
  const previous = await pool.query<{ setting_key: string; setting_value: unknown; updated_by_user_id: number | null }>("select setting_key,setting_value,updated_by_user_id from system_settings where category='authoritative_orthanc'");
  try {
    await pool.query("delete from system_settings where category='authoritative_orthanc'");
    await pool.query("insert into system_settings(category,setting_key,setting_value,updated_by_user_id) values('authoritative_orthanc','enabled',$1::jsonb,$2)", [JSON.stringify({ value: "enabled" }), userId]);
    assert.equal((await readAuthoritativeOrthancSettings()).autoExportClinicalDocuments, true);

    const saved = await saveAuthoritativeOrthancSettings({ enabled: true, autoExportClinicalDocuments: false, baseUrl: "http://orthanc.test:8042", username: "rispro", password: "secret", timeoutSeconds: 10, verifyTls: true, displayName: "Test" }, userId);
    assert.equal(saved.autoExportClinicalDocuments, false);
    assert.equal((await readAuthoritativeOrthancSettings()).autoExportClinicalDocuments, false);
    assert.equal(saved.passwordConfigured, true);
    assert.equal("password" in saved, false);
    assert.equal("password" in await readAuthoritativeOrthancSettingsForDisplay(), false);
  } finally {
    await pool.query("delete from audit_log where changed_by_user_id=$1 and entity_type in ('integration','system_setting')", [userId]).catch(() => undefined);
    await pool.query("delete from system_settings where category='authoritative_orthanc'");
    for (const setting of previous.rows) await pool.query("insert into system_settings(category,setting_key,setting_value,updated_by_user_id) values('authoritative_orthanc',$1,$2::jsonb,$3)", [setting.setting_key, JSON.stringify(setting.setting_value), setting.updated_by_user_id]);
    await pool.query("delete from users where id=$1", [userId]).catch(() => undefined);
  }
});
