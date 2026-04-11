# Appointments V2 Task Ledger

## Current state

Planning complete enough to start implementation after final doc normalization.

## Global rules

- Do not modify legacy scheduling logic unless the task explicitly says so.
- Every stage has:
  - one implementer agent
  - one reviewer or hardening agent
- Keep prompts narrow.
- Keep diffs focused.
- Update this file when a stage begins or ends.

## Current stage order

| Stage | Name | Status | Primary owner | Reviewer | Notes |
|---|---|---|---|---|---|
| 0 | Legacy freeze and inventory | pending | Agent A | Agent B | add freeze markers, inventory frozen files |
| 1 | V2 architecture normalization | pending | Agent A | Agent B | finalize docs and naming |
| 2 | Backend scaffold | pending | Agent A | Agent B | routes, folders, placeholders only |
| 3 | V2 DB schema | pending | Agent A | Agent B | additive migrations only |
| 4 | Pure decision engine | pending | Agent C | Agent D | unit tests mandatory |
| 5 | Scheduling availability APIs | pending | Agent C | Agent D | explicit decision output |
| 6 | Transactional booking | pending | Agent E | Agent F | lock, re-check, write |
| 7 | Admin policy versioning | pending | Agent G | Agent H | authoritative saves |
| 8 | Shadow mode and observability | pending | Agent E | Agent F | diff logging |
| 9 | Frontend V2 | pending | Agent I | Agent J | new UI only |
| 10 | Validation and cutover | pending | Agent Lead | Agent Review | final switch plan |

## File ownership map

### Agent A
- docs/appointments-v2/*
- src/modules/appointments-v2/index.ts
- src/modules/appointments-v2/api/routes/* during scaffold stage only

### Agent B
- review only
- compile safety
- no route redesign without approval

### Agent C
- src/modules/appointments-v2/rules/*
- src/modules/appointments-v2/tests/unit/*

### Agent D
- review of rule outputs
- bug fixes in rules only

### Agent E
- src/modules/appointments-v2/booking/*
- booking integration tests

### Agent F
- booking hardening
- concurrency test fixes
- no schema changes without approval

### Agent G
- src/modules/appointments-v2/admin/*
- policy repositories
- policy versioning tests

### Agent H
- admin hardening
- bug fixes only in admin-related files

### Agent I
- frontend/src/v2/appointments/*
- frontend api v2 hooks

### Agent J
- frontend bug fixes only
- no backend changes

## Current blockers

- `ARCHITECTURE.md` must be finalized
- `DECISIONS.md` must be committed
- final API naming must be locked
- final migration names must be reserved

## Stage exit rule

A stage is complete only when:
- code compiles
- tests for that stage pass
- reviewer signoff is recorded here
- next stage owner can start without reinterpreting prior decisions

## Next action

Start Stage 0 after committing:
- `ARCHITECTURE.md`
- `DECISIONS.md`
- `TASK_LEDGER.md`
- `ALL_STAGES.md`