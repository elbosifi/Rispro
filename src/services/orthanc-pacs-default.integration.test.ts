import test from "node:test";
import assert from "node:assert/strict";
import { pool } from "../db/pool.js";

const service = await import("./orthanc-pacs-service.js");

const category = "pacs";
const settingKey = "orthanc_remote_modalities";

test.after(async () => { await pool.end(); });

test("upserting a new default clears the old default and later detail edits preserve it", async (t) => {
  try { await pool.query("select 1"); } catch { t.skip("PostgreSQL is not reachable at configured DATABASE_URL."); return; }
  const previous = await pool.query<{ setting_value: unknown; updated_by_user_id: number | null }>("select setting_value,updated_by_user_id from system_settings where category=$1 and setting_key=$2", [category, settingKey]);
  const configurations = new Map<string, [string, string, number]>([
    ["iMac", ["IMAC_AE", "10.0.0.10", 104]],
    ["PAX2", ["PAX2_AE", "10.0.0.20", 11112]],
  ]);
  try {
    await pool.query("delete from system_settings where category=$1 and setting_key=$2", [category, settingKey]);
    await pool.query("insert into system_settings(category,setting_key,setting_value) values($1,$2,$3::jsonb)", [category, settingKey, JSON.stringify({ value: [
      { key: "iMac", aet: "IMAC_AE", host: "10.0.0.10", port: 104, isDefault: true },
      { key: "PAX2", aet: "PAX2_AE", host: "10.0.0.20", port: 11112, isDefault: false },
    ] })]);
    service.__setOrthancPacsSettingsForTests({ enabled: true, shadowMode: false, connectionMode: "internal", baseUrl: "http://orthanc:8042", username: "", password: "", timeoutSeconds: 10, verifyTls: true, sendOnlyWhenPatientEntersQueue: false, worklistTarget: "", strategyPreference: "put_first", mwlCompatibility: {} });
    service.__setOrthancPacsAuditLoggerForTests(async () => null);
    service.__setOrthancPacsFetchForTests(async (path, options) => {
      if (path === "/modalities") return { status: 200, ok: true, text: JSON.stringify([...configurations.keys()]), json: [...configurations.keys()] };
      const match = path.match(/^\/modalities\/([^/]+)(?:\/configuration)?$/);
      if (!match) throw new Error(`Unexpected Orthanc path ${path}`);
      const key = decodeURIComponent(match[1]!);
      if (options?.method === "PUT") configurations.set(key, options.body as [string, string, number]);
      const body = configurations.get(key) || [];
      return { status: 200, ok: true, text: JSON.stringify(body), json: body };
    });

    await service.upsertOrthancRemoteModality({ key: "PAX2", payload: { aet: "PAX2_AE", host: "10.0.0.20", port: 11112, isDefault: true }, currentUserId: null });
    const stored = await pool.query<{ setting_value: { value: Array<{ key: string; isDefault: boolean }> } }>("select setting_value from system_settings where category=$1 and setting_key=$2", [category, settingKey]);
    assert.deepEqual(stored.rows[0]!.setting_value.value.map(({ key, isDefault }) => ({ key, isDefault })), [{ key: "iMac", isDefault: false }, { key: "PAX2", isDefault: true }]);
    assert.equal(stored.rows[0]!.setting_value.value.filter((item) => item.isDefault).length, 1);
    const first = await service.listOrthancRemoteModalities();
    assert.deepEqual(first.modalities.map(({ key, isDefault }) => ({ key, isDefault })), [{ key: "iMac", isDefault: false }, { key: "PAX2", isDefault: true }]);
    assert.equal(first.modalities.filter((item) => item.isDefault).length, 1);

    await service.upsertOrthancRemoteModality({ key: "PAX2", payload: { aet: "PAX2_NEW", host: "10.0.0.21", port: 11113 }, currentUserId: null });
    const updated = await service.listOrthancRemoteModalities();
    assert.deepEqual(updated.modalities.find((item) => item.key === "PAX2"), { key: "PAX2", aet: "PAX2_NEW", host: "10.0.0.21", port: 11113, isDefault: true, configurationError: null });
    assert.equal(updated.modalities.filter((item) => item.isDefault).length, 1);
  } finally {
    service.__resetOrthancPacsFetchForTests();
    service.__resetOrthancPacsSettingsForTests();
    service.__resetOrthancPacsAuditLoggerForTests();
    await pool.query("delete from system_settings where category=$1 and setting_key=$2", [category, settingKey]);
    if (previous.rows[0]) await pool.query("insert into system_settings(category,setting_key,setting_value,updated_by_user_id) values($1,$2,$3::jsonb,$4)", [category, settingKey, JSON.stringify(previous.rows[0].setting_value), previous.rows[0].updated_by_user_id]);
  }
});
