# Doctor Portal

## Purpose

Doctor Portal contains doctor-facing cases, reporting worklists, rosters, availability, workload planning, protocols, protocol libraries, and admin doctor management.

## Current Known Code Locations

- Backend module: `src/modules/doctor-portal/`
- Backend mount/export surface: `src/modules/doctor-portal/index.ts`
- Frontend pages: `frontend/src/pages/doctor/`
- Doctor Portal docs: `docs/doctor-portal-roster-planning.md`, `docs/doctor-portal-user-management.md`, `docs/doctor-portal-staging-validation.md`, `docs/doctor-portal-production-rollout.md`
- Reporting Board validation: `docs/doctor-portal/reporting-board-staging-validation.md`

## Current Known Risks

- Doctor Portal shares core patients, appointments, scheduling, capacity, print, QR, PACS, and receptionist workflows with RISpro Core.
- Role/capability checks are spread across middleware, route guards, frontend route registry, and page visibility settings.
- Reporting Board and workload behavior can be affected by changes in roster/availability rules.

## What Agents Must Not Do

- Do not change core scheduling, registration, booking, print, QR, PACS, or queue behavior as a side effect of Doctor Portal work.
- Do not bypass Doctor Portal middleware/capability checks.
- Do not mix roster/protocol/reporting changes unless the task explicitly spans them.

## Recommended Tests Before Touching

- Backend unit/integration depending on scope: `node --import tsx --test src/modules/doctor-portal/*.test.ts`
- DB-backed checks require `npm run db:test:check` first.
- Frontend: `cd frontend && npm run test -- src/pages/doctor`
- Typechecks: `npm run typecheck` and `npm run typecheck:frontend`

## Follow-Up Gaps

- Needs inspection: authoritative ownership boundaries between roster planning, workload rules, and assignment rules.
- Needs inspection: full route/capability matrix documentation.
- Needs inspection: E2E coverage for the doctor landing, roster, reporting board, and protocol paths.
