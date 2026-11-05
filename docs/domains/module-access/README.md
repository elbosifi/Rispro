# Module access

Module admission is an outer authorization boundary. It does not grant an action,
patient, appointment, document, report or DICOM study permission.

## Policy and persistence

- [The code registry](../../../src/modules/module-access/module-registry.ts) defines module IDs, bilingual names, frontend/API routes, landing pages, availability and shared-service eligibility.
- [The resolver](../../../src/modules/module-access/module-access-service.ts) intersects account state, module grants and the existing module capabilities. Sessions, middleware, administrator effective-access reporting, viewer checks and scanner tokens use it.
- Migration [247](../../../src/db/migrations/247_user_module_access.sql) adds `users.module_access_mode`, `users.default_landing_module` and `user_module_grants`. Module IDs are text, so adding a module does not require a new user column.
- `legacy` retains existing Core roles, active Doctor profiles, Gamma Knife assignments/settings authority and the existing Teaching permission adapter. Future modules with `legacyAccess: false` are not automatically granted to ordinary legacy accounts. Unrestricted Super Admins retain administrative admission; module-specific clinical checks still apply.
- `restricted` admits only saved grants that are currently usable. An empty or unknown grant set denies all modules. Shared account-security operations do not grant clinical access.
- Existing Gamma Knife-only accounts migrate to restricted Gamma Knife grants. Passwords, records and sessions are preserved. `gamma_knife_only` remains a compatibility mirror, with a trigger for old insertions; clearing that old flag alone cannot reopen Core. The deprecated administrator endpoint delegates to the generic update service.

The effective policy is returned by password/passkey login, password change,
reauthentication and `/api/auth/me`. The frontend uses that payload for protected
routes, workspace switching and landing selection. Shared report pages admit
Core or Doctor Workspace while keeping their existing record authorization.

## Administration and revocation

Settings → Users & Roles → Manage → Security → Module Access supports multiple
grants and a default module. It shows effective admission separately from clinical
permissions. Doctor profile/modality permissions remain in Doctors Directory;
Gamma Knife and Teaching retain their own action-permission systems.

The update endpoint is `PUT /api/users/:userId/module-access`:

```json
{"mode":"restricted","grants":["doctor","gamma-knife"],"defaultModule":"doctor"}
```

Existing supervisor/Super Admin authority, protected-account checks and recent
reauthentication apply. Administrators cannot change their own module grants or
increase their own clinical permissions. Super Admin accounts cannot be restricted.
An active restricted account cannot lose its last usable module through a grant,
role, profile or Gamma Knife permission update. To intentionally leave no modules,
deactivate the account first; reactivation requires a usable module.

Grant changes lock the user row, update grants and the compatibility mirror,
increment `auth_version`, revoke viewer contexts and write a before/after security
audit in one transaction. Relevant Doctor/Gamma Knife permission changes also
increment authentication versions. Existing last-Super-Admin protections remain.
The user security history displays the actor, timestamp, modules and landing change.

Backend admission changes take effect on subsequent requests. The frontend
rechecks sessions every 30 seconds and immediately after an authorization denial.
It blocks the revoked session while retaining the mounted screen and draft until
the user chooses to leave. Workspace changes continue through the existing unsaved
navigation guard. Already delivered image/document bytes cannot be recalled.

## Shared and nonstandard endpoints

[The API boundary](../../../src/modules/module-access/module-access-middleware.ts)
classifies shared operations by exact method and route, rather than exempting
authentication, printing, integrations or settings namespaces.

- Own password, passkeys and Action PIN status/set/verify/idle lock remain available. Administrative endpoints retain module, role and reauthentication checks.
- Dictation health/transcription require an authorized module marked for dictation; server configuration remains Core/Super-Admin controlled.
- MedGemma clinical health/generation retains active Doctor Workspace authorization; its administrator settings remain Core-scoped.
- Scanner setup exposes only scanner settings through `/api/scanner-bootstrap/settings`. Workstation/QZ support is available to authorized clinical modules; other printing APIs retain their original scope and authorization.
- Generic companion scan tokens recheck the requesting user's live Core admission. Gamma Knife scanning stays on its episode-specific document endpoints and requires `documents` permission.
- `/ohif-dicomweb`, viewer launch/context/study/renewal routes, native gateway authorization and recovery check live module access. Study allowlists, source binding, profile/appointment checks and the native gateway secret remain authoritative.
- Public Gamma Knife QR reads retain their independent token, release and document-visibility checks. Internal HTTPS, renderer and mobile/public token routes retain their existing service-token controls. Static viewer/frontend assets confer no clinical-data access.

Gamma Knife document bytes require `documents` permission both before storage
read and immediately before the response. Profile document metadata/history is
filtered when that permission is absent. Generic document endpoints continue
excluding Gamma Knife documents.

## Registering a future module

1. Add a registry entry with a unique ID, route prefixes, names and landing path.
   Start with `available: false`, `capability: 'explicit'`, `legacyAccess: false`
   and `dictation: false`. For example, use `id: 'laboratory'`,
   `frontendPrefixes: ['/laboratory']` and `apiPrefixes: ['/laboratory']`.
2. Implement its own router, module-specific actions and record authorization.
   Mount it with `requireModuleAccess('laboratory')`, and wrap the frontend route
   with the existing `ProtectedRoute`. Do not reuse a Core clinical API as a
   substitute for the new module's record authorization.
3. Set `available: true` only when the module is usable. Ordinary existing users
   receive no automatic grant. An administrator can then select it in the existing
   editor; the workspace switcher consumes its registry metadata automatically.
4. Add real-application tests for admission, action/record denials, active-session
   revocation and migration compatibility. Enable shared services only when the
   module actually uses them. If eligibility needs a dedicated profile, extend the
   central resolver rather than scattering role checks across routes.

No Laboratory, Pharmacy or Radiotherapy functionality is included in this change.

## Separate Gamma Knife historical reference

Migration [248](../../../src/db/migrations/248_gamma_knife_historical_references.sql)
and [the reference service](../../../src/modules/gamma-knife/historical-treatment-service.ts)
add an audited reference to completed treatment in an earlier closed episode of
the same patient. A clinical user can select it in Treatment courses and must give
a reason. Database and service checks reject cross-patient/self/active-episode
references. Episode revision checks and retained history apply. This evidence does
not approve a new course or relax current assessment, MDT, readiness or the
one-active-episode constraint.
