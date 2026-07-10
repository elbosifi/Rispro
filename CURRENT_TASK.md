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

- Minimal change:
- Targeted tests:
- Stop conditions:

## Result

- Files changed:
- Validation run:
- Blockers or skipped checks:
