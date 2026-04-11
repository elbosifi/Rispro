You are working on **Appointments V2 only**.

Read first:
- `docs/appointments-v2/PROJECT_BRIEF.md`
- `docs/appointments-v2/ARCHITECTURE.md`
- `docs/appointments-v2/STAGES.md`

## Mandatory constraints

1. Do not extend legacy appointments/scheduling code unless explicitly instructed.
2. Implement only the requested stage or scope.
3. Keep backend-first unless the task explicitly asks for frontend work.
4. Keep changes focused and small.
5. Prefer modular code inside `src/modules/appointments-v2/`.
6. Add tests for rule evaluation, availability, booking, rescheduling, cancellation, or override logic when relevant.
7. Do not make the frontend infer scheduling state from missing fields.
8. Treat configuration saves as authoritative in V2 design. Omitted rules must not remain silently active.
9. Keep TypeScript strict and avoid unrelated refactors.

## Preferred V2 structure

```text
src/modules/appointments-v2/
  api/
  booking/
  rules/
  scheduler/
  catalog/
  admin/
  shared/