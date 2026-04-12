# AGENTS.md

This document provides working rules for all contributors and coding agents in this repository.
Appointments V2 rules are a scoped subsection below.

---

## General repo rules

1. The backend is Node.js + Express + TypeScript (`.ts` files via `tsx`).
2. The frontend is React 19 + TypeScript + Vite, served from `frontend/`.
3. All backend code lives under `src/`. Use ES module syntax (`import`/`export`).
4. Route files are named `*-routes.ts`, services `*-service.ts`, middleware `*-middleware.ts`.
5. Database is PostgreSQL. Use the shared pool from `src/db/pool.ts`.
6. New feature modules go under `src/modules/<feature-name>/`.
7. Frontend pages live under `frontend/src/`. V2 pages are under `frontend/src/v2/`.
8. Run `npm run typecheck` and `cd frontend && npx tsc --noEmit` before committing.
9. Tests use Node's native `node:test`. Run with `npm test`.
10. Legacy appointments code (outside `src/modules/appointments-v2/`) is maintained but not extended — see Legacy freeze policy below.

---

## Appointments V2 rules

Read these first before any Appointments V2 task:
- docs/appointments-v2/PROJECT_BRIEF.md
- docs/appointments-v2/ARCHITECTURE.md
- docs/appointments-v2/DECISIONS.md
- docs/appointments-v2/TASK_LEDGER.md

### Core rules

1. Legacy appointments and scheduling code is frozen.
2. Do not add new scheduling features to legacy code.
3. All new scheduling and booking work must go into Appointments V2.
4. Appointments V2 lives in:
   - backend: `src/modules/appointments-v2/`
   - frontend: `frontend/src/v2/appointments/`
5. Do not use ad hoc scheduling logic.
6. Scheduling decisions must come from explicit backend rule evaluation.
7. Frontend must not infer scheduling truth from missing fields.
8. Configuration saves in V2 must be authoritative.
9. Booking must re-check decision and capacity inside the transaction before commit.

### Current status (April 12, 2026)

Appointments V2 backend (Stages 2–8) and frontend (Stage 8/9) are **functionally complete**:
- Decision engine: `pureEvaluate()` — all 7 D008 precedence steps implemented
- Availability, suggestions, evaluate APIs: fully wired
- Booking CRUD (create, reschedule, cancel, list): fully wired with transactional safety
- Admin policy versioning (draft, save, publish, preview): fully wired
- Shadow mode: implemented and gated behind `SHADOW_MODE_ENABLED`
- Frontend page at `/v2/appointments`: modality selector, availability table, booking form, bookings list with cancel/reschedule buttons, override dialogs
- 229 V2 tests: 215 pass, 0 fail, 14 cancelled when run in parallel (both integration suites pass 100% individually against PostgreSQL)
- 0 TypeScript errors in frontend and V2 backend
- 7 bugs fixed during integration testing (see `docs/appointments-v2/CUTOVER_CHECKLIST.md`)

The module is ready for validation and cutover planning. See `docs/appointments-v2/CUTOVER_CHECKLIST.md` for deployment steps.

### Multi-agent rules

- One primary implementer agent per stage or sub-scope.
- One secondary reviewer / bug-fix agent per stage.
- Do not edit files outside your assigned scope.
- Shared files should have one owner for the current stage.
- Do not mix frontend and backend implementation in one task unless explicitly requested.

### Legacy freeze policy

Legacy appointments code may only receive:
- critical bug containment
- temporary compatibility fixes explicitly requested
- reference-only maintenance

It is not the target architecture.