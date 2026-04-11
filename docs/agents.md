# AGENTS.md

Read these first before any Appointments V2 task:
- docs/appointments-v2/PROJECT_BRIEF.md
- docs/appointments-v2/ARCHITECTURE.md
- docs/appointments-v2/DECISIONS.md
- docs/appointments-v2/TASK_LEDGER.md
- docs/appointments-v2/STAGES.md

## Core rules

1. Legacy appointments and scheduling code is frozen.
2. Do not add new scheduling features to legacy code.
3. All new scheduling and booking work must go into Appointments V2.
4. Appointments V2 lives in:
   - backend: src/modules/appointments-v2/
   - frontend: frontend/src/v2/appointments/
5. Do not use ad hoc scheduling logic.
6. Scheduling decisions must come from explicit backend rule evaluation.
7. Frontend must not infer scheduling truth from missing fields.
8. Configuration saves in V2 must be authoritative.
9. Booking must re-check decision and capacity inside the transaction before commit.
10. Keep tasks small and stage-based.

## Multi-agent rules

- One primary implementer agent per stage or sub-scope.
- One secondary reviewer / bug-fix agent per stage.
- Do not edit files outside your assigned scope.
- Shared files should have one owner for the current stage.
- Do not mix frontend and backend implementation in one task unless explicitly requested.

## Legacy freeze policy

Legacy appointments code may only receive:
- critical bug containment
- temporary compatibility fixes explicitly requested
- reference-only maintenance

It is not the target architecture.