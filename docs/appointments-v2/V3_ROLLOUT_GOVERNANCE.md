# Appointments V3 Rollout Governance

V3 is the only forward development path for receptionist booking UI.

## Migration and rollout rules

- V3 must remain behind a feature flag/internal route until parity is proven.
- Reception staff must not alternate between legacy, V2, and V3 during operations.
- V3 becomes default only after parity and scenario-pack signoff.
- Once V3 is default, legacy and V2 booking entry points must be removed from normal receptionist navigation.
- Legacy may remain only as controlled fallback/admin access until final retirement.
- If parity defects are found during pilot/rollout, revert to the approved fallback workflow instead of mixed UI operation.

## Parity gate before default rollout

V3 must match backend-enforced behavior for create/reschedule validation, supervisor override enforcement, override reason requirement, special quota consumption, and quota release on cancel/reschedule.

V3 must not weaken backend scheduling semantics and must use the same authoritative evaluator for create and reschedule.

## Locked special reason semantics

`specialReasonCode` is metadata/audit justification only. It must not independently alter scheduling decisions unless explicitly approved in a future policy change.
