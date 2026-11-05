import type { PoolClient } from 'pg';
import { pool } from '../../db/pool.js';
import type { Role } from '../../types/domain.js';
import type { UserId } from '../../types/http.js';
import { HttpError } from '../../utils/http-error.js';
import { logSecurityAuditEntry } from '../../services/audit-service.js';
import { assertCanManageProtectedAccount } from '../../services/protected-account-authorization.js';
import { MODULE_REGISTRY, type ModuleDefinition } from './module-registry.js';
import { resolveLegacyTeachingBootstrapPermissions } from '../teaching/services/legacy-teaching-permission-adapter.js';

type Db = PoolClient | typeof pool;
export interface ModuleAccess {
  mode: 'legacy' | 'restricted';
  grants: string[];
  defaultModule: string | null;
  landingConfigured: boolean;
  landingPath: string | null;
  modules: Array<ModuleDefinition & { eligible: boolean; granted: boolean; effective: boolean; permissions: string[] }>;
}

/** Read-only and shared by sessions, middleware, viewer checks and administration. */
export async function resolveModuleAccess(userId: UserId, db: Db = pool, registry = MODULE_REGISTRY): Promise<ModuleAccess> {
  const result = await db.query<{
    role: Role; is_active: boolean; module_access_mode: 'legacy' | 'restricted'; default_landing_module: string | null;
    grants: string[]; gamma_knife_permissions: string[]; doctor: boolean; teaching: boolean; teaching_profile: boolean; teaching_permissions: string[];
  }>(`select u.role,u.is_active,u.module_access_mode,u.default_landing_module,u.gamma_knife_permissions,
    array(select module_id from user_module_grants where user_id=u.id order by module_id) as grants,
    exists(select 1 from teaching.user_profiles p where p.identity_issuer='rispro' and p.identity_subject=u.id::text) as teaching_profile,
    array(select permission from teaching.user_permissions p where p.identity_issuer='rispro' and p.identity_subject=u.id::text order by permission) as teaching_permissions,
    (u.role in ('supervisor','super_admin') or (u.role='doctor' and exists(select 1 from doctor_portal.doctor_profiles p where p.user_id=u.id and p.active))) as doctor,
    (exists(select 1 from teaching.user_permissions p where p.identity_issuer='rispro' and p.identity_subject=u.id::text and p.permission='teaching.access')
      or (u.role in ('doctor','supervisor','super_admin') and not exists(select 1 from teaching.user_profiles p where p.identity_issuer='rispro' and p.identity_subject=u.id::text))) as teaching
    from users u where u.id=$1`, [userId]);
  const u = result.rows[0];
  if (!u) throw new HttpError(404, 'User not found.');
  const modules = registry.map(m => {
    const admin = ['supervisor','super_admin'].includes(u.role);
    const permissions = m.id === 'gamma-knife' ? u.gamma_knife_permissions : m.id === 'teaching' ? (u.teaching_profile ? u.teaching_permissions : [...resolveLegacyTeachingBootstrapPermissions(u.role)]) : [];
    const capabilities = { core: true, doctor:u.doctor, teaching:u.teaching, 'gamma-knife':admin || u.gamma_knife_permissions.includes('access'), explicit:true };
    const eligible = m.available && capabilities[m.capability];
    const granted = u.module_access_mode === 'legacy' ? (m.legacyAccess || u.role === 'super_admin') : u.grants.includes(m.id);
    const landingPath = m.id === 'gamma-knife' && !permissions.includes('access') ? '/gamma-knife/settings' : m.landingPath;
    return { ...m, landingPath, eligible, granted, effective: u.is_active && eligible && granted, permissions };
  });
  const landing = modules.find(m => m.id === u.default_landing_module && m.effective) ?? modules.find(m => m.effective);
  const landingPath = landing?.landingPath ?? null;
  return { mode: u.module_access_mode, grants: u.grants, defaultModule: u.default_landing_module ?? landing?.id ?? null, landingConfigured: u.default_landing_module !== null, landingPath, modules };
}

export function hasModuleAccess(access: ModuleAccess, moduleId: string): boolean {
  return access.modules.some(m => m.id === moduleId && m.effective);
}

export async function assertModuleAccess(userId: UserId, moduleIds: string | readonly string[], db: Db = pool): Promise<void> {
  const access = await resolveModuleAccess(userId, db);
  if (!(typeof moduleIds === 'string' ? [moduleIds] : moduleIds).some(id => hasModuleAccess(access, id))) {
    throw new HttpError(403, 'Module access is not authorized.', { code: 'MODULE_ACCESS_DENIED' });
  }
}

/** Call after changing an inner capability, in the same locked user transaction. */
export async function assertUsableModuleAccess(userId: UserId, db: Db): Promise<void> {
  const access = await resolveModuleAccess(userId, db);
  const active = await db.query<{ is_active: boolean }>('select is_active from users where id=$1', [userId]);
  if (active.rows[0]?.is_active && access.mode === 'restricted' && !access.modules.some(m => m.effective)) {
    throw new HttpError(409, 'This would remove the last usable module. Assign another usable module or explicitly deactivate the account first.');
  }
}

export async function updateModuleAccess(userId: UserId, input: unknown, actor: { userId: UserId | null; role: Role }): Promise<ModuleAccess> {
  if (!Number.isSafeInteger(Number(userId)) || Number(userId) <= 0) throw new HttpError(400, 'Invalid user ID.');
  userId = Number(userId);
  if (!['supervisor','super_admin'].includes(actor.role)) throw new HttpError(403, 'Administrator required.');
  if (Number(userId) === Number(actor.userId)) throw new HttpError(403, 'Administrators cannot change their own module access.');
  const body = input as { mode?: unknown; grants?: unknown; defaultModule?: unknown } | null;
  if (!body || !['legacy','restricted'].includes(String(body.mode)) || !Array.isArray(body.grants) || body.grants.some(id => typeof id !== 'string' || !MODULE_REGISTRY.some(m => m.id === id && m.available))) throw new HttpError(400, 'Choose registered, available modules and a valid access mode.');
  if (body.defaultModule !== null && !MODULE_REGISTRY.some(m => m.id === body.defaultModule && m.available)) throw new HttpError(400, 'Choose a registered landing module.');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const target = (await client.query<{ role: Role; is_active: boolean }>('select role,is_active from users where id=$1 for update', [userId])).rows[0];
    if (!target) throw new HttpError(404, 'User not found.');
    assertCanManageProtectedAccount(actor.role, target.role, actor.userId, userId);
    if (target.role === 'super_admin' && body.mode !== 'legacy') throw new HttpError(409, 'Super administrators must retain full administrative access.');
    const before = await resolveModuleAccess(userId, client);
    const grants = [...new Set(body.grants as string[])].sort();
    await client.query('delete from user_module_grants where user_id=$1', [userId]);
    await client.query('insert into user_module_grants(user_id,module_id,granted_by) select $1,unnest($2::text[]),$3', [userId, grants, actor.userId]);
    await client.query(`update users set module_access_mode=$2,default_landing_module=$3,
      gamma_knife_only=false where id=$1`, [userId, body.mode, body.defaultModule]);
    await assertUsableModuleAccess(userId, client);
    const after = await resolveModuleAccess(userId, client);
    if (body.defaultModule !== null && !after.modules.some(m => m.id === body.defaultModule && m.eligible && m.granted)) throw new HttpError(409, 'The landing module must have both a grant and the required module permissions.');
    // Mirror the old flag without invoking the compatibility trigger's narrowing path.
    // New code never uses this flag as the source of admission authority.
    if (body.mode === 'restricted' && grants.length === 1 && grants[0] === 'gamma-knife') {
      await client.query("update users set gamma_knife_only=true where id=$1", [userId]);
    }
    await client.query('update users set auth_version=auth_version+1,updated_at=now() where id=$1', [userId]);
    await client.query('update viewer_launch_sessions set revoked_at=coalesce(revoked_at,now()) where user_id=$1', [userId]);
    await logSecurityAuditEntry({ entityType: 'user', entityId: userId, actionType: 'update_module_access', oldValues: before, newValues: { ...after, outcome:'successful' }, changedByUserId: actor.userId }, client);
    await client.query('commit');
    return after;
  } catch (error) { await client.query('rollback'); throw error; }
  finally { client.release(); }
}
