# Appointments

## Purpose

Appointments V2 is the modular, rule-driven scheduling, booking, capacity, policy, queue, public cancellation, and appointment-read model. Legacy appointment/scheduling code remains for compatibility only.

## Current Known Code Locations

- Backend V2 module: `src/modules/appointments-v2/`
- Frontend V2 UI: `frontend/src/v2/appointments/`
- Legacy scheduling domain: `src/domain/scheduling/`
- Registration and operational appointment surfaces: `frontend/src/pages/registrations/`, `frontend/src/pages/calendar/`, `frontend/src/pages/queue/`, `frontend/src/pages/modality/`
- Appointments V2 docs: `docs/appointments-v2/PROJECT_BRIEF.md`, `docs/appointments-v2/ARCHITECTURE.md`, `docs/appointments-v2/DECISIONS.md`, `docs/appointments-v2/TASK_LEDGER.md`

## Current Known Risks

- Legacy and V2 scheduling boundaries are easy to blur.
- Capacity and rule evaluation must stay backend-authoritative.
- DB-backed tests require a verified local test DB.
- Shadow diff logging currently exists in the Appointments V2 observability folder and should not be broken.

## What Agents Must Not Do

- Do not add new scheduling features to legacy appointment code.
- Do not let frontend infer scheduling truth from missing fields.
- Do not bypass transaction-time decision/capacity checks for booking.
- Do not remove or rewrite existing Appointments V2 documentation.

## Recommended Tests Before Touching

- Backend unit suite: `npm run test:backend:unit`
- Appointments V2 targeted unit: `node --import tsx --test src/modules/appointments-v2/tests/unit/*.test.ts`
- DB-backed V2 tests: `npm run db:test:check`, then targeted files under `src/modules/appointments-v2/tests/integration/`
- Frontend V2 tests: `cd frontend && npm run test -- src/v2/appointments`
- Typechecks: `npm run typecheck` and `npm run typecheck:frontend`

## Follow-Up Gaps

- Needs inspection: concise current-state index over the Appointments V2 docs.
- Needs inspection: which V2 integration tests are required for each subdomain.
- Needs inspection: migration path for shadow diff logs into shared observability logger.
