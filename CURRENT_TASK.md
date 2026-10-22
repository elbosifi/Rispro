# User Management and Account Security Goal

## Task

Continue the User Management and Account Security Goal from the user-provided objective. Preserve the committed role editor; implement only remaining security controls, last-login data, effective-access visibility, account-specific security history, and confirmed session-security fixes.

## Git workflow

- Temporary local branch: `codex/user-management-security-goal`
- Starting `main` SHA: `daddb2ab716402ea6582e42dc8230329ec708490`
- No push, pull request, or deployment.
- After required validation, squash-apply onto unchanged local `main`, leave review changes uncommitted, and retain the temporary branch.

## Constraints

- Reuse `auth_version`, existing User Management and Doctor Directory services, audit infrastructure, shared UI components, and React Query conventions.
- Do not modify migration `231_user_auth_version.sql`; add a later migration only if needed.
- Do not add a sessions table, generic permission framework, or unrelated refactors.
- Run focused backend and DB tests, relevant frontend checks, typechecks/build/lint, and Chromium desktop/mobile plus English/Arabic/RTL checks.
- Report blocked or unrun validations accurately.
