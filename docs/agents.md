# AGENTS.md

This repository is actively building **Appointments V2**.

Read these first before doing any Appointments V2 task:
- `docs/appointments-v2/PROJECT_BRIEF.md`
- `docs/appointments-v2/ARCHITECTURE.md`
- `docs/appointments-v2/STAGES.md`

## Core rules

1. Treat the existing appointments/scheduling implementation as **legacy**.
2. Do **not** extend legacy scheduling logic unless the task explicitly says to patch legacy code.
3. All new scheduling and booking work must go into **Appointments V2** only.
4. Prefer **small, staged changes** over broad rewrites.
5. Keep backend and frontend V2 work modular and separated from legacy code.
6. For booking logic, prefer:
   - explicit rule precedence
   - side-effect-free decision functions
   - transactional booking writes
   - test coverage for rule evaluation and booking flows
7. Do not infer availability state in the frontend from missing fields. The backend must return explicit booking state.
8. Configuration saves in V2 must be **authoritative**. Omitted rules must not remain silently active.
9. Keep naming explicit. Use `appointments-v2` / `appointment_v2_*` conventions for new code and tables unless the task specifies otherwise.
10. Keep code compiling and avoid unnecessary refactors outside task scope.

## Legacy freeze policy

The legacy appointments module remains temporarily available only for:
- reference
- comparison
- bug containment if explicitly requested

It is not the target architecture.

## Preferred V2 principles

- Backend-first implementation
- Pure decision service before write-path logic
- Slot-aware scheduling model
- Explicit override workflow
- Clear audit trail
- Strong tests around rules, capacity, rescheduling, and cancellation

## Expected task style

When implementing Appointments V2:
- read the V2 docs first
- implement only the requested stage
- keep the diff focused
- include tests where logic changes
- avoid hidden behavior changes in legacy code