import type { PoolClient } from "pg";
import { pool } from "../../db/pool.js";
import { HttpError } from "../../utils/http-error.js";
import { logSecurityAuditEntry } from "../../services/audit-service.js";
import { decryptRuntimeSecret, encryptRuntimeSecret, isRuntimeSecretEncryptionConfigured, type RuntimeSecretBundle } from "../../services/runtime-secret-crypto.js";
import { validateMedGemmaUrl, type MedGemmaConnection } from "./medgemma-client.js";
import { DEFAULT_MEDGEMMA_INSTRUCTIONS, isMedGemmaTask, validateMedGemmaInstructions, type MedGemmaTask } from "./task-instructions.js";

interface GenerationSettings { instructions: Record<MedGemmaTask, string>; temperature: number; maxGeneratedTokens: number }
export interface MedGemmaSettings extends MedGemmaConnection, GenerationSettings { enabled: boolean; apiKeyConfigured: boolean; encryptionReady: boolean; instructionDefaults: Record<MedGemmaTask, string> }
interface StoredSettings extends MedGemmaConnection, GenerationSettings { enabled: boolean; apiKeySecret: RuntimeSecretBundle | null }
const defaults: StoredSettings = { enabled: false, baseUrl: "", timeoutSeconds: 180, allowInsecureHttp: false, apiKeySecret: null, instructions: DEFAULT_MEDGEMMA_INSTRUCTIONS, temperature: 0.1, maxGeneratedTokens: 2048 };

// Existing connection records acquire the new defaults without a migration.
function withDefaults(value?: Partial<StoredSettings>): StoredSettings {
  return { ...defaults, ...value, instructions: { ...DEFAULT_MEDGEMMA_INSTRUCTIONS, ...value?.instructions } };
}

async function readSettings(db: Pick<PoolClient, "query"> = pool): Promise<StoredSettings> {
  const result = await db.query<{ setting_value: StoredSettings }>("select setting_value from system_settings where category='medgemma' and setting_key='connection'");
  return withDefaults(result.rows[0]?.setting_value);
}
function publicSettings(value: StoredSettings): MedGemmaSettings {
  return { enabled: value.enabled, baseUrl: value.baseUrl, timeoutSeconds: value.timeoutSeconds, allowInsecureHttp: value.allowInsecureHttp, apiKeyConfigured: Boolean(value.apiKeySecret), encryptionReady: isRuntimeSecretEncryptionConfigured(), instructions: value.instructions, instructionDefaults: DEFAULT_MEDGEMMA_INSTRUCTIONS, temperature: value.temperature, maxGeneratedTokens: value.maxGeneratedTokens };
}
export async function getMedGemmaSettings(): Promise<MedGemmaSettings> { return publicSettings(await readSettings()); }
export async function resolveMedGemmaSettings(): Promise<MedGemmaSettings & { apiKey: string }> {
  const stored = await readSettings();
  const settings = publicSettings(stored);
  if (!settings.enabled) throw new HttpError(409, "MedGemma is disabled.");
  if (!settings.baseUrl) throw new HttpError(409, "MedGemma is not configured.");
  if (!settings.encryptionReady) throw new HttpError(503, "Platform credential encryption is unavailable.");
  try { return { ...settings, apiKey: stored.apiKeySecret ? decryptRuntimeSecret(stored.apiKeySecret) : "" }; }
  catch { throw new HttpError(503, "The saved MedGemma API key cannot be decrypted. Check platform encryption or replace the key."); }
}

export async function saveMedGemmaSettings(value: unknown, userId: number | string): Promise<MedGemmaSettings> {
  const input = value as Record<string, unknown> | null;
  if (!input || typeof input.enabled !== "boolean" || typeof input.baseUrl !== "string" || typeof input.allowInsecureHttp !== "boolean" || !Number.isInteger(input.timeoutSeconds) || Number(input.timeoutSeconds) < 10 || Number(input.timeoutSeconds) > 600 || (input.apiKey !== undefined && typeof input.apiKey !== "string") || (input.removeApiKey !== undefined && typeof input.removeApiKey !== "boolean")) throw new HttpError(400, "Invalid MedGemma settings. Timeout must be 10–600 seconds.");
  const connection: MedGemmaConnection = { baseUrl: input.baseUrl.trim(), timeoutSeconds: Number(input.timeoutSeconds), allowInsecureHttp: input.allowInsecureHttp };
  if (connection.baseUrl) connection.baseUrl = validateMedGemmaUrl(connection);
  if (input.enabled && !connection.baseUrl) throw new HttpError(400, "A MedGemma server URL is required before enabling MedGemma.");
  const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
  if (apiKey.length > 4096 || /[^\x21-\x7e]/.test(apiKey)) throw new HttpError(400, "API key must contain printable header characters without spaces.");
  if (input.removeApiKey && apiKey) throw new HttpError(400, "Choose either replacing or removing the API key.");
  if ((input.enabled || apiKey) && !isRuntimeSecretEncryptionConfigured()) throw new HttpError(503, "Platform credential encryption is unavailable.");
  if (input.temperature !== undefined && (typeof input.temperature !== "number" || !Number.isFinite(input.temperature) || input.temperature < 0 || input.temperature > 1)) throw new HttpError(400, "Temperature must be between 0 and 1.");
  if (input.maxGeneratedTokens !== undefined && (!Number.isInteger(input.maxGeneratedTokens) || Number(input.maxGeneratedTokens) < 128 || Number(input.maxGeneratedTokens) > 8192)) throw new HttpError(400, "Maximum generated tokens must be 128–8192.");
  if (input.instructions !== undefined) {
    if (!input.instructions || typeof input.instructions !== "object" || Array.isArray(input.instructions)) throw new HttpError(400, "Invalid instruction presets.");
    for (const [task, instruction] of Object.entries(input.instructions)) {
      if (!isMedGemmaTask(task)) throw new HttpError(400, "Unknown instruction task.");
      validateMedGemmaInstructions(instruction);
    }
  }
  const client = await pool.connect();
  try {
    await client.query("begin");
    // Insert the disabled default once, then lock the row to retain concurrent key updates.
    await client.query("insert into system_settings(category,setting_key,setting_value) values('medgemma','connection',$1::jsonb) on conflict(category,setting_key) do nothing", [JSON.stringify(defaults)]);
    const locked = await client.query<{ id: string; setting_value: StoredSettings }>("select id,setting_value from system_settings where category='medgemma' and setting_key='connection' for update");
    const old = withDefaults(locked.rows[0].setting_value);
    const stored: StoredSettings = { ...connection, enabled: input.enabled, apiKeySecret: input.removeApiKey ? null : apiKey ? encryptRuntimeSecret(apiKey) : old.apiKeySecret, instructions: { ...old.instructions, ...input.instructions as Partial<Record<MedGemmaTask, string>> }, temperature: input.temperature === undefined ? old.temperature : Number(input.temperature), maxGeneratedTokens: input.maxGeneratedTokens === undefined ? old.maxGeneratedTokens : Number(input.maxGeneratedTokens) };
    await client.query("update system_settings set setting_value=$1::jsonb,updated_by_user_id=$2,updated_at=now() where id=$3", [JSON.stringify(stored), userId, locked.rows[0].id]);
    const settings = publicSettings(stored);
    await logSecurityAuditEntry({ entityType: "medgemma_configuration", entityId: locked.rows[0].id, actionType: "medgemma_settings_updated", changedByUserId: userId, oldValues: publicSettings(old), newValues: { ...settings, credentialAction: input.removeApiKey ? "removed" : apiKey ? "replaced" : "retained" } }, client);
    await client.query("commit");
    return settings;
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}
