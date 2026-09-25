import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "../../db/pool.js";
import { logAuditEntry } from "../../services/audit-service.js";
import { HttpError } from "../../utils/http-error.js";
import type { UserId } from "../../types/http.js";

export const MOBILE_WIDGET_SCOPE = "mobile.operations-summary:read";
const columns = `id, device_name as "deviceName", token_prefix as "tokenPrefix", scope,
  created_by_user_id as "createdBy", created_at as "createdAt", expires_at as "expiresAt",
  last_used_at as "lastUsedAt", revoked_at as "revokedAt",
  case when revoked_at is not null then 'revoked' when expires_at <= now() then 'expired' else 'active' end as status`;
type TokenRow = { id: string; deviceName: string; tokenPrefix: string; scope: string; createdBy: string;
  createdAt: Date; expiresAt: Date; lastUsedAt: Date | null; revokedAt: Date | null; status: "active" | "expired" | "revoked" };
export function hashMobileToken(secret: string): string { return createHash("sha256").update(secret).digest("hex"); }

export async function assertMobileManager(userId: UserId, executor: PoolClient | typeof pool = pool) {
  const { rows } = await executor.query(`select id from users where id = $1 and is_active
    and role in ('supervisor', 'super_admin') and not must_change_password`, [userId]);
  if (!rows.length) throw new HttpError(403, "Active supervisor access required.");
}

export async function listMobileTokens() {
  const { rows } = await pool.query<TokenRow>(`select ${columns},
    (select full_name from users where users.id = created_by_user_id) as "createdByName"
    from mobile_widget_tokens order by created_at desc, id desc`);
  return rows;
}

async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try { await client.query("begin"); const result = await fn(client); await client.query("commit"); return result; }
  catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}

function validateInput(name: unknown, expiry: unknown) {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 100 || /[\x00-\x1f]/.test(name)) {
    throw new HttpError(400, "Device name must contain 1 to 100 characters.");
  }
  const expiresAt = typeof expiry === "string" ? new Date(expiry) : new Date(NaN);
  const remaining = expiresAt.getTime() - Date.now();
  if (!Number.isFinite(remaining) || remaining < 60_000 || remaining > 366 * 86400_000) {
    throw new HttpError(400, "Expiry must be between one minute and 366 days from now.");
  }
  return { deviceName: name.trim(), expiresAt };
}

async function insertToken(client: PoolClient, actor: UserId, deviceName: string, expiresAt: Date) {
  const secret = `rwm_${randomBytes(32).toString("base64url")}`;
  const { rows } = await client.query<TokenRow>(`insert into mobile_widget_tokens
    (device_name, token_hash, token_prefix, scope, created_by_user_id, expires_at)
    values ($1, $2, $3, $4, $5, $6) returning ${columns}`,
  [deviceName, hashMobileToken(secret), secret.slice(0, 12), MOBILE_WIDGET_SCOPE, actor, expiresAt]);
  return { token: rows[0], secret };
}

async function audit(client: PoolClient, actor: UserId, action: string, token: TokenRow) {
  await logAuditEntry({ entityType: "mobile_widget_token", entityId: token.id, actionType: `security_mobile_widget_${action}`,
    changedByUserId: actor, newValues: { tokenId: token.id, deviceName: token.deviceName,
      tokenPrefix: token.tokenPrefix, scope: token.scope, expiresAt: token.expiresAt } }, client);
}

export async function createMobileToken(actor: UserId, name: unknown, expiry: unknown) {
  const input = validateInput(name, expiry);
  return transaction(async client => {
    await assertMobileManager(actor, client);
    const result = await insertToken(client, actor, input.deviceName, input.expiresAt);
    await audit(client, actor, "created", result.token);
    return result;
  });
}

export async function changeMobileToken(actor: UserId, id: string, action: "rotate" | "revoke", expiry?: unknown) {
  if (!/^[1-9]\d*$/.test(id)) throw new HttpError(400, "Invalid device ID.");
  return transaction(async client => {
    await assertMobileManager(actor, client);
    const { rows } = await client.query<TokenRow>(`select ${columns} from mobile_widget_tokens where id = $1 for update`, [id]);
    const old = rows[0];
    if (!old) throw new HttpError(404, "Device not found.");
    if (old.revokedAt) throw new HttpError(409, "Device has already been revoked.");
    const replacement = action === "rotate"
      ? await insertToken(client, actor, old.deviceName, validateInput(old.deviceName, expiry).expiresAt) : null;
    await client.query(`update mobile_widget_tokens set revoked_at = now(), revoked_by_user_id = $2, replaced_by_id = $3 where id = $1`,
      [id, actor, replacement?.token.id ?? null]);
    await audit(client, actor, action === "rotate" ? "rotated" : "revoked", old);
    if (replacement) await audit(client, actor, "created", replacement.token);
    return replacement;
  });
}

export async function authenticateMobileToken(authorization: string | undefined): Promise<string> {
  const match = /^Bearer (rwm_[A-Za-z0-9_-]{43})$/i.exec(authorization ?? "");
  if (!match) throw new HttpError(401, "Invalid mobile credential.");
  const { rows } = await pool.query<{ id: string; scope: string }>(`select t.id, t.scope from mobile_widget_tokens t
    join users u on u.id = t.created_by_user_id
    where t.token_hash = $1 and t.revoked_at is null and t.expires_at > now()
      and u.is_active and u.role in ('supervisor', 'super_admin') and not u.must_change_password`, [hashMobileToken(match[1])]);
  const token = rows[0];
  if (!token) throw new HttpError(401, "Invalid mobile credential.");
  if (token.scope !== MOBILE_WIDGET_SCOPE) throw new HttpError(403, "Insufficient mobile scope.");
  await pool.query(`update mobile_widget_tokens set last_used_at = now() where id = $1
    and (last_used_at is null or last_used_at < now() - interval '5 minutes')`, [token.id]);
  return token.id;
}
