import type { RequestHandler } from 'express';
import { optionalAuth, requireAuth } from '../../middleware/auth.js';
import { HttpError } from '../../utils/http-error.js';
import { pathWithin } from './module-registry.js';
import { assertModuleAccess, hasModuleAccess, resolveModuleAccess, type ModuleAccess } from './module-access-service.js';

/** Exact shared operations, never an authentication/settings namespace exemption. */
export function requiredModulesForApi(method: string, path: string, access: ModuleAccess): readonly string[] | 'shared' {
  if (method === 'GET' && /^\/public\/gamma-knife(?:\/documents\/\d+)?$/.test(path)) return 'shared';
  // These endpoints authenticate each request with a scoped bearer/token value;
  // an unrelated RISpro session cookie must not turn a public/mobile link into a
  // module-authorized Core or Doctor request.
  if (pathWithin(path, '/public/appointments') || pathWithin(path, '/internal/appointment-slip-render')) return 'shared';
  if (method === 'GET' && path === '/mobile/operations-summary') return 'shared';
  if (['GET','POST'].includes(method) && pathWithin(path, '/reporting/saved-views/public')) return 'shared';
  if ((method === 'GET' && ['/auth/me','/public/institution-identity','/action-pin/status','/teaching/health'].includes(path))
    || (method === 'POST' && ['/auth/login','/auth/logout','/auth/refresh','/auth/change-password','/auth/re-auth',
      '/auth/passkeys/register/options','/auth/passkeys/register/verify','/auth/passkeys/login/options','/auth/passkeys/login/verify','/auth/passkeys/re-auth/options','/auth/passkeys/re-auth/verify',
      '/action-pin/idle-lock','/action-pin/verify','/action-pin/set','/action-pin/disable'].includes(path))) return 'shared';
  if ((method === 'GET' && path === '/medical-dictation/health') || (method === 'POST' && path === '/medical-dictation/transcribe')) return access.modules.filter(m => m.dictation).map(m => m.id);
  if (pathWithin(path, '/medical-dictation')) return ['core'];
  if ((method === 'GET' && path === '/medgemma/health') || (method === 'POST' && path === '/medgemma/generate')) return ['doctor'];
  if (method === 'GET' && path === '/settings/users-and-roles/page-visibility') return ['core','doctor'];
  if ((method === 'GET' && ['/scanner-bootstrap/windows-setup','/scanner-bootstrap/settings','/printing/qz-certificate','/printing/runtime-config'].includes(path))
    || (method === 'POST' && ['/printing/qz-sign','/printing/audit','/printing/printer-test/pdf'].includes(path))) return access.modules.filter(m => m.workstationPath).map(m => m.id);
  if (method === 'POST' && path === '/printing/report-center/pdf') return ['core','doctor'];
  if (method === 'GET' && /^\/v2\/read\/registrations\/appointments\/\d+\/protocol-assignment$/.test(path)) return ['core','doctor'];
  if ((method === 'GET' && (/^\/comparisons(?:\/\d+(?:\/documents|\/internal-link-target)?)?$/.test(path) || /^\/comparisons\/patients\/\d+\/previous-studies$/.test(path) || path === '/comparisons/reporting-doctors'))
    || (method === 'POST' && (/^\/comparisons(?:\/\d+\/(?:assign|unassign|cancel|confirm-materials|finalize|return-to-preparation|documents(?:\/\d+\/attach)?))?$/.test(path)))
    || (method === 'DELETE' && /^\/comparisons\/\d+\/documents\/\d+$/.test(path))
    || (method === 'PATCH' && /^\/comparisons\/\d+$/.test(path))) return ['core','doctor'];
  if (pathWithin(path, '/ohif') || pathWithin(path, '/native-reporting')) return ['core','doctor'];
  // Identity-only endpoint lets the existing Core header discover Doctor capabilities.
  if (method === 'GET' && path === '/doctor/me') return ['core','doctor'];
  return access.modules.filter(m => m.apiPrefixes.some(p => pathWithin(path, p))).map(m => m.id);
}

export const enforceModuleApiAccess: RequestHandler = (req, res, next) => {
  optionalAuth(req, res, error => {
    if (error) return next(error);
    if (!req.user) return next(); // Public/token-scoped routes retain their own authentication.
    void (async () => {
      const access = await resolveModuleAccess(req.user!.sub);
      let path: string;
      try { path = decodeURIComponent(req.path).replace(/\/+$/, '') || '/'; }
      catch { throw new HttpError(400, 'Invalid API path.'); }
      const required = requiredModulesForApi(req.method, path, access);
      // Existing public/token routes keep their own controls. Registered modules,
      // including future modules, always use the effective admission policy.
      if (access.mode === 'legacy' && required !== 'shared' && required.length === 0) return next();
      if (required === 'shared' || required.some(id => hasModuleAccess(access, id))) return next();
      throw new HttpError(403, 'Module access is not authorized.', { code: 'MODULE_ACCESS_DENIED' });
    })().catch(next);
  });
};

export function requireModuleAccess(moduleId: string | readonly string[]): RequestHandler {
  return (req, res, next) => requireAuth(req, res, error => {
    if (error) return next(error);
    void assertModuleAccess(req.user!.sub, moduleId).then(() => next()).catch(next);
  });
}
