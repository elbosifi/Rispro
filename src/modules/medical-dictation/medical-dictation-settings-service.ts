import type { PoolClient } from "pg";
import { pool } from "../../db/pool.js";
import { HttpError } from "../../utils/http-error.js";
import { logSecurityAuditEntry } from "../../services/audit-service.js";
import { decryptRuntimeSecret, encryptRuntimeSecret, isRuntimeSecretEncryptionConfigured, type RuntimeSecretBundle } from "../../services/runtime-secret-crypto.js";
import { validateMedAsrUrl, type MedAsrConnection } from "./medasr-client.js";

export interface MedicalDictationSettings extends MedAsrConnection { enabled: boolean; apiKeyConfigured: boolean; encryptionReady: boolean }
interface Row { enabled: boolean; base_url: string; timeout_seconds: number; allow_insecure_http: boolean; api_key_secret: RuntimeSecretBundle | null }
async function readRow(db: Pick<PoolClient, "query"> = pool): Promise<Row> {
  const result = await db.query<Row>("select enabled, base_url, timeout_seconds, allow_insecure_http, api_key_secret from medical_dictation_configuration where id=1");
  if (!result.rows[0]) throw new HttpError(503, "Medical Dictation settings are not initialized. Run database migrations.");
  return result.rows[0];
}
function publicSettings(row: Row): MedicalDictationSettings {
  return { enabled: row.enabled, baseUrl: row.base_url, timeoutSeconds: row.timeout_seconds, allowInsecureHttp: row.allow_insecure_http, apiKeyConfigured: Boolean(row.api_key_secret), encryptionReady: isRuntimeSecretEncryptionConfigured() };
}
export async function getMedicalDictationSettings(): Promise<MedicalDictationSettings> { return publicSettings(await readRow()); }
export async function resolveMedicalDictationSettings(): Promise<MedicalDictationSettings & { apiKey: string }> {
  const row = await readRow();
  const settings = publicSettings(row);
  if (!settings.enabled) throw new HttpError(409, "Medical Dictation is disabled.");
  if (!settings.baseUrl) throw new HttpError(409, "Medical Dictation is not configured.");
  if (!settings.encryptionReady) throw new HttpError(503, "Platform credential encryption is unavailable. Contact the RISpro administrator.");
  try { return { ...settings, apiKey: row.api_key_secret ? decryptRuntimeSecret(row.api_key_secret) : "" }; }
  catch { throw new HttpError(503, "The saved MedASR API key cannot be decrypted. Check platform encryption or replace the key."); }
}
export async function saveMedicalDictationSettings(value: unknown, userId: number | string): Promise<MedicalDictationSettings> {
  const input = value as Record<string, unknown> | null;
  if (!input || typeof input.enabled !== "boolean" || typeof input.baseUrl !== "string" || typeof input.allowInsecureHttp !== "boolean" || !Number.isInteger(input.timeoutSeconds) || Number(input.timeoutSeconds) < 10 || Number(input.timeoutSeconds) > 600 || (input.apiKey !== undefined && typeof input.apiKey !== "string") || (input.removeApiKey !== undefined && typeof input.removeApiKey !== "boolean")) throw new HttpError(400, "Invalid Medical Dictation settings. Timeout must be 10–600 seconds.");
  const connection: MedAsrConnection = { baseUrl: input.baseUrl.trim(), timeoutSeconds: Number(input.timeoutSeconds), allowInsecureHttp: input.allowInsecureHttp };
  if (connection.baseUrl) connection.baseUrl = validateMedAsrUrl(connection);
  if (input.enabled && !connection.baseUrl) throw new HttpError(400, "A MedASR server address is required before enabling dictation.");
  const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  if (apiKey.length > 4096 || /[^\x21-\x7e]/.test(apiKey)) throw new HttpError(400, "API key must contain printable header characters without spaces.");
  if (input.removeApiKey && apiKey) throw new HttpError(400, "Choose either replacing or removing the API key.");
  if ((input.enabled || apiKey) && !isRuntimeSecretEncryptionConfigured()) throw new HttpError(503, "Platform credential encryption is unavailable. Configure RISpro's existing encryption prerequisite before enabling dictation or saving an API key.");
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select id from medical_dictation_configuration where id=1 for update");
    const old = await readRow(client);
    const secret = input.removeApiKey ? null : apiKey ? encryptRuntimeSecret(apiKey) : old.api_key_secret;
    const updated = await client.query<Row>(`update medical_dictation_configuration set enabled=$1,base_url=$2,timeout_seconds=$3,allow_insecure_http=$4,api_key_secret=$5::jsonb,updated_by_user_id=$6,updated_at=now() where id=1 returning *`, [input.enabled, connection.baseUrl, connection.timeoutSeconds, connection.allowInsecureHttp, secret ? JSON.stringify(secret) : null, userId]);
    const result = publicSettings(updated.rows[0]);
    await logSecurityAuditEntry({ entityType: "medical_dictation_configuration", entityId: 1, actionType: "medical_dictation_settings_updated", changedByUserId: userId, oldValues: publicSettings(old), newValues: { ...result, credentialAction: input.removeApiKey ? "removed" : apiKey ? "replaced" : "retained" } }, client);
    await client.query("commit");
    return result;
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}
