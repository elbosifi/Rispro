# Current Task

## Task

- One sentence: Repair Audit Log optional filtering and add super-admin System Diagnostics.
- Scope: Audit Log, diagnostics persistence/API/error correlation/backup instrumentation, bounded Settings section, documentation.
- Out of scope: Unrelated Settings redesigns and production data.

## Inspection

- Files checked: Audit route/service, Express app/error handler/auth, admin backup routes, Settings page, API hooks.
- Current behavior: Audit page asks for 50 records but renders 10; omitted changedByUserId is rejected.
- Root cause: Audit filter call site used a required positive-integer normalization for an optional route filter.

## Plan

- Minimal change: Add a backend-authoritative paginated audit contract, deterministic classifier/presentation/redaction helpers, bounded CSV streaming, justified indexes, and a dedicated Settings Audit Log component. Preserve the existing separate System Diagnostics surface.
- Targeted tests: `src/services/audit-service.test.ts`, `src/services/audit-event-classifier.test.ts`, and existing diagnostics redaction tests.
- Stop conditions: Stop on unrelated test failures or Docker/database environment failures; do not modify unrelated Settings or Statistics behavior.

## Result

- Files changed: Audit route/service/classifier/tests, audit API types/mappers/hooks, dedicated `audit-log-section.tsx`, Settings wiring, migration `115_audit_log_explorer_indexes.sql`, and `docs/AUDIT_LOG.md`.
- Validation run: Agent contract passed; targeted audit/classifier/diagnostics tests passed 7/7; backend unit suite passed 834/834; backend typecheck passed; frontend typecheck and production build passed; `git diff --check` passed.
- Blockers or skipped checks: `npm run agent:preflight` reports Docker execution blocked by the environment, so portable DB startup and DB-backed audit validation were not run. Full frontend suite reached unrelated existing Statistics failures (8 failed, 633 passed, 7 skipped); no Statistics changes were made. Manual browser verification was unavailable because the required in-app browser execution tool was not exposed.
