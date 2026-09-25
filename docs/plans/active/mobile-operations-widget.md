# Execution Plan: Mobile Operations Widget

## Problem

iPhone operational awareness needs a read-only aggregate contract without patient details or browser credentials.

## Scope

Dedicated summary/token backend, migration 215, Settings child section and translations, Scriptable source, tests and documentation.

## Files Likely to Touch

- `src/modules/mobile-widget/`
- `src/db/migrations/215_mobile_widget_tokens.sql`
- `src/app.ts`
- `frontend/src/pages/settings/mobile-widget-access-section.tsx`
- Settings composition, API module and paired i18n catalogs
- `docs/mobile/`, `scripts/mobile/`, dedicated E2E spec

## Explicit Non-Goals

No appointment mutation, queue cleanup, reporting/PACS changes, native app, public patient API or general API-key framework.

## Acceptance Criteria

Secure lifecycle and re-auth, Tripoli aggregates, privacy and read-only proof, bilingual responsive Settings, all widget families with Keychain/cache handling, reviewed browser evidence and required validation.

## Validation Commands

- `npm run agent:contract`
- `npm run agent:preflight`
- `npm run db:test:up` and `npm run db:test:check`
- Focused DB, component, Scriptable and browser tests
- Backend/frontend typechecks, frontend build, i18n and relevant auth/Settings/V2 regressions
- Broader relevant suites and `git diff --check`

## Rollback Considerations

Temporary branch retains a local reference. Main must stay unchanged until validation passes. No push, PR or deployment. Migration only adds the dedicated token table; no production data is touched.

## Execution Notes

- Starting local `main` and `origin/main` were `108b749c519bda42c047f565c687b5b78c17f273`; implementation branch is `codex/mobile-operations-widget-goal`. A final fetch confirmed both references remain at the starting SHA.
- Environment preflight reported `DOCKER_OK`; disposable PostgreSQL startup/check passed and migration 215 applied. The focused mobile-widget DB integration suite passes 6/6, including token lifecycle, authorization, Tripoli aggregate semantics, privacy, and read-only assertions. Appointments V2 booking-flow integration passes 41/41.
- Focused Settings/re-auth/composition/i18n tests pass 21/21. Full frontend suite reports 2,034 passed and 2 failed across 163 files. The exact Doctor assignment-clear and Registrations deep-link failures reproduce on clean `main` (119 passed, the same 2 failed), so they are pre-existing and unrelated to this goal.
- Backend unit suite passes; Action PIN route guardrails pass 13/13 after preserving its expected mount order while explicitly applying forced-password-change protection to widget management routes. Backend and frontend typechecks pass; frontend production build passes. Frontend lint exits 0 with seven warnings in untouched files.
- Scriptable mocked contract/family checks pass 15/15. The dedicated Chromium workflow passes 1/1 after final route wiring, covering create/re-auth/rotate/revoke, old/new credential behavior, privacy, English/Arabic, and widths 1440/768/430/390/360. Screenshots under `test-results/mobile-widget-access-mobil-87e1d-ive-English-Arabic-Settings-chromium/` were inspected; the latest muted-text contrast and RTL layouts are readable. The disposable E2E database was stopped afterward.
- `npm run agent:contract`, `npm run agent:preflight`, `npm run harness:all`, native i18n parity/placeholder checks, and `git diff --check` pass. The aggregate query plan on the tiny disposable dataset used one sequential scan (0.605 ms, 7 shared-buffer hits); no speculative index was added.
- Sandbox `spawn EPERM`/Docker access errors were classified as environment restrictions and the unchanged checks were retried outside the sandbox. No production database was accessed.
