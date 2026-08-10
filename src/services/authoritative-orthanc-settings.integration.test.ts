import assert from "node:assert/strict";
import test from "node:test";
import { pool } from "../db/pool.js";
import { __resetAuthoritativeOrthancForTests, __setAuthoritativeOrthancAutoRouteDestinationLoaderForTests, __setAuthoritativeOrthancFetchForTests, readAuthoritativeOrthancSettings, readAuthoritativeOrthancSettingsForDisplay, saveAuthoritativeOrthancSettings } from "./authoritative-orthanc-service.js";

test.after(async () => { await pool.end(); });

test("persists authoritative settings defaults and synchronizes the selected auto-route destination", async (t) => {
  try { await pool.query("select 1"); } catch { t.skip("PostgreSQL is not reachable at configured DATABASE_URL."); return; }
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const user = await pool.query<{ id: number }>("insert into users(username,full_name,password_hash,role,is_active) values($1,$1,'test','super_admin',true) returning id", [`orthanc_auto_export_${suffix}`]);
  const userId = Number(user.rows[0]!.id);
  const previous = await pool.query<{ setting_key: string; setting_value: unknown; updated_by_user_id: number | null }>("select setting_key,setting_value,updated_by_user_id from system_settings where category='authoritative_orthanc'");
  try {
    await pool.query("delete from system_settings where category='authoritative_orthanc'");
    await pool.query("insert into system_settings(category,setting_key,setting_value,updated_by_user_id) values('authoritative_orthanc','enabled',$1::jsonb,$2)", [JSON.stringify({ value: "enabled" }), userId]);
    const defaults = await readAuthoritativeOrthancSettings();
    assert.equal(defaults.autoExportClinicalDocuments, true);
    assert.equal(defaults.autoRouteEnabled, false);
    assert.equal(defaults.autoRouteDestinationKey, "");

    const calls: Array<{ path: string; method: string }> = [];
    __setAuthoritativeOrthancAutoRouteDestinationLoaderForTests(async () => ({ modalities: [{ key: "PACS_A", aet: "PACS_AE", host: "10.0.0.10", port: 104 }] }));
    __setAuthoritativeOrthancFetchForTests(async (url, init) => { calls.push({ path: new URL(String(url)).pathname, method: init?.method || "GET" }); return new Response(null, { status: 200 }); });
    const saved = await saveAuthoritativeOrthancSettings({ enabled: true, autoExportClinicalDocuments: false, autoRouteEnabled: true, autoRouteDestinationKey: "PACS_A", baseUrl: "http://orthanc.test:8042", username: "rispro", password: "secret", timeoutSeconds: 10, verifyTls: true, displayName: "Test" }, userId);
    assert.equal(saved.autoExportClinicalDocuments, false);
    assert.equal(saved.autoRouteEnabled, true);
    assert.equal(saved.autoRouteDestinationKey, "PACS_A");
    const persisted = await readAuthoritativeOrthancSettings();
    assert.equal(persisted.autoExportClinicalDocuments, false);
    assert.equal(persisted.autoRouteEnabled, true);
    assert.equal(persisted.autoRouteDestinationKey, "PACS_A");
    assert.deepEqual(calls, [{ path: "/modalities/rispro_autoroute", method: "PUT" }]);
    assert.equal(saved.passwordConfigured, true);
    assert.equal("password" in saved, false);
    assert.equal("password" in await readAuthoritativeOrthancSettingsForDisplay(), false);
  } finally {
    __resetAuthoritativeOrthancForTests();
    await pool.query("delete from audit_log where changed_by_user_id=$1 and entity_type in ('integration','system_setting')", [userId]).catch(() => undefined);
    await pool.query("delete from system_settings where category='authoritative_orthanc'");
    for (const setting of previous.rows) await pool.query("insert into system_settings(category,setting_key,setting_value,updated_by_user_id) values('authoritative_orthanc',$1,$2::jsonb,$3)", [setting.setting_key, JSON.stringify(setting.setting_value), setting.updated_by_user_id]);
    await pool.query("delete from users where id=$1", [userId]).catch(() => undefined);
  }
});
