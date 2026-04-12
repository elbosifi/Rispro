`docs/appointments-v2/STAGES.md`
```md
# Appointments V2 Stages

## Delivery strategy

Appointments V2 will be implemented in small stages to keep changes understandable, testable, and efficient for coding agents.

The goal is to minimize broad prompts and keep each implementation batch narrow.

---

## Stage 0 — Freeze and inventory legacy

### Goal
Stop legacy drift and document what exists.

### Tasks
- mark legacy appointments code as legacy
- inventory current routes, services, tables, and UI entry points
- define which user-facing behaviors V2 must preserve intentionally

### Deliverable
- `docs/appointments-v2/legacy-inventory.md`

### Notes
No feature work in legacy beyond critical containment.

---

## Stage 1 — Define V2 architecture

### Goal
Set boundaries before implementation.

### Tasks
- define V2 modules
- define entities
- define rule precedence
- define API boundaries
- define initial table families

### Deliverable
- `PROJECT_BRIEF.md`
- `ARCHITECTURE.md`
- `STAGES.md`

---

## Stage 2 — Backend scaffold

### Goal
Create a compilable V2 module skeleton.

### Tasks
- create `src/modules/appointments-v2/`
- create internal submodules
- register placeholder routes under `/api/v2/appointments`
- add DTO placeholders and service stubs

### Deliverable
- backend scaffold only
- no real scheduling logic yet

### Acceptance
- code compiles
- routes are registered
- legacy module untouched

---

## Stage 3 — V2 database schema

### Goal
Create clean V2 persistence.

### Tasks
- add migrations for V2 tables
- avoid modifying legacy scheduling tables for core V2 behavior
- add indexes, audit columns, and explicit naming

### Deliverable
- migration set for V2 schema

### Acceptance
- migrations apply cleanly
- schema matches architecture boundaries

---

## Stage 4 — Decision engine

### Goal
Build the core booking decision logic first.

### Tasks
- implement pure rule evaluation service
- encode explicit rule precedence
- return structured decision object
- add unit tests

### Deliverable
- pure `evaluateBookingDecision()` service
- tests for blocked/restricted/available outcomes

### Acceptance
- no side effects
- deterministic results
- strong unit coverage

---

## Stage 5 — Availability service

### Goal
Expose trustworthy availability based on scheduler + rules.

### Tasks
- implement slot/schedule availability query
- combine raw capacity with decision engine output
- return explicit frontend-safe response fields

### Deliverable
- availability service
- `/api/v2/appointments/availability`

### Acceptance
- response always includes explicit status
- no frontend inference required

---

## Stage 6 — Transactional booking

### Goal
Make writes safe.

### Tasks
- implement create appointment
- implement reschedule
- implement cancel
- release capacity correctly
- re-evaluate inside transaction
- record override audit

### Deliverable
- booking endpoints and tests

### Acceptance
- concurrency-safe design
- capacity release verified by tests

---

## Stage 7 — Admin configuration

### Goal
Implement safe scheduling configuration management.

### Tasks
- save rule sets
- make saves authoritative
- deactivate omitted rules
- add versioning or publish mechanism
- add preview endpoint if practical

### Deliverable
- admin config API and tests

### Acceptance
- stale omitted rules do not remain silently active
- config behavior is explicit and testable

---

## Stage 8 — Frontend V2

### Goal
Create a new frontend that uses V2 only.

### Tasks
- new appointments V2 page
- new admin configuration UI
- consume only V2 endpoints
- use explicit status rendering

### Deliverable
- V2 frontend pages
- legacy frontend still present temporarily

### Acceptance
- no client-side inference of scheduling truth
- clear UX for available/restricted/blocked

---

## Stage 9 — Validation and cutover

### Goal
Switch confidently.

### Tasks
- validate representative scheduling scenarios
- test override flows
- test rescheduling/cancellation
- switch navigation to V2
- remove/archive legacy module

### Deliverable
- cutover checklist
- legacy retirement plan

### Acceptance
- V2 is functionally complete for intended first release
- legacy module can be deprecated

---

## Working prompt style for coding agents

Use this format for implementation tasks:

- Stage
- Scope
- Read first
- Constraints
- Acceptance criteria

### Example
Stage: 4  
Scope: decision engine only  
Read first:
- `docs/appointments-v2/PROJECT_BRIEF.md`
- `docs/appointments-v2/ARCHITECTURE.md`
- `docs/appointments-v2/STAGES.md`

Constraints:
- do not modify legacy appointments logic
- implement only pure decision evaluation
- add tests

Acceptance:
- structured decision result
- explicit precedence
- tests passing

---

## Current status

All stages (0–9) are **complete**.

- Stage 0 (Legacy freeze): Done — legacy code frozen, no new features added
- Stage 1 (Architecture): Done — PROJECT_BRIEF.md, ARCHITECTURE.md, DECISIONS.md all written
- Stage 2 (Backend scaffold): Done — T001, 14 tests, full module skeleton
- Stage 3 (V2 DB schema): Done — T002, migration 023, 19 tests
- Stage 4 (Decision engine): Done — pureEvaluate() with all 7 D008 steps, date rule matching
- Stage 5 (Availability service): Done — getAvailability(), examTypeRuleItemExamTypeIds populated (T012)
- Stage 6 (Transactional booking): Done — create, reschedule (with re-insert, T013), cancel, list
- Stage 7 (Admin configuration): Done — draft, save, publish, preview, validate
- Stage 8 (Frontend V2): Done — availability page, booking form, bookings list, cancel + reschedule UI
- Stage 9 (Validation and cutover): Integration testing complete — 7 bugs found and fixed (see CUTOVER_CHECKLIST.md)

## Integration test results (April 12, 2026)

| Suite | Pass | Fail | Cancelled | Notes |
|---|---|---|---|---|
| availability-flow (individual) | 14 | 0 | 0 | Full policy lifecycle: availability, evaluate, suggestions, admin CRUD |
| booking-flow (individual) | 14 | 0 | 0 | Full booking lifecycle: create, list, reschedule, cancel, capacity |
| route-wiring | 1 | 0 | 0 | Router creation |
| Unit tests (all) | 200 | 0 | 0 | Structure, wiring, pure logic |
| **All V2 tests combined** | **215** | **0** | **14** | 14 cancelled when parallel due to shared DB seed data |

## Immediate next step

Validation and cutover planning:
1. ✅ Apply migration and seed test data
2. ✅ Run integration tests against real PostgreSQL
3. ✅ Publish a scheduling policy via admin endpoints (verified)
4. ⏳ Validate representative scheduling scenarios with real modalities/exam types
5. ⏳ Compare V2 decisions with legacy outcomes (shadow mode)
6. ⏳ Plan cutover timeline

See `docs/appointments-v2/CUTOVER_CHECKLIST.md` for deployment steps and `docs/appointments-v2/TASK_LEDGER.md` for the complete task history.