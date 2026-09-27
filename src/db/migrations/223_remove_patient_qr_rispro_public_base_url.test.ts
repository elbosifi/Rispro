import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { pool } from "../pool.js";

test("migration 223 removes only the retired Patient QR public URL setting idempotently", async () => {
  const client = await pool.connect();
  const migrationPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "223_remove_patient_qr_rispro_public_base_url.sql");
  try {
    await client.query("begin");
    await client.query(
      `
        insert into system_settings (category, setting_key, setting_value)
        values ('patient_qr_self_service', 'config', $1::jsonb)
        on conflict (category, setting_key) do update set setting_value = excluded.setting_value
      `,
      [JSON.stringify({ value: { enabled: false, printQrOnAppointmentSlip: true, risproPublicBaseUrl: "https://legacy.example.test" } })]
    );
    const migration = await readFile(migrationPath, "utf8");
    await client.query(migration);
    await client.query(migration);
    const result = await client.query<{ setting_value: { value: Record<string, unknown> } }>(
      `select setting_value from system_settings where category = 'patient_qr_self_service' and setting_key = 'config'`
    );
    assert.deepEqual(result.rows[0]?.setting_value.value, { enabled: false, printQrOnAppointmentSlip: true });
  } finally {
    await client.query("rollback").catch(() => undefined);
    client.release();
  }
});
