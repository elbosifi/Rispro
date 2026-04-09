# Scheduling Engine Technical Notes

## Rule Precedence
1. Integrity checks (missing entities, invalid links, malformed config)
2. Hard blocks (modality blocked rules, non-overridable by default)
3. Exam type restrictions (overridable only when configured)
4. Capacity checks (category limits first, then special quota)
5. Override eligibility (explicit supervisor approval required)

## Override Semantics
- Overrides are never implicit.
- Candidate evaluation must explicitly return `requiresSupervisorOverride`.
- Final create/update requires supervisor credentials payload.
- Every override attempt is appended to `scheduling_override_audit_events`.
- If supervisor approval succeeds but booking/update fails before commit, an `approved_but_failed` event is appended as a best-effort post-rollback audit record.
- If supervisor approval succeeds but booking/update fails later, an `approved_but_failed` event is appended (best-effort) after transaction rollback.

## Concurrency Strategy
- Booking create/update runs inside a DB transaction.
- Booking path uses advisory locks keyed by:
  - modality id
  - appointment date
  - case category
  - exam type bucket (when quota relevant)
- Scheduling candidate is evaluated again inside the transaction before write.
- Conflict/race outcomes return retryable conflict errors and do not silently overbook.

## Quota Consumption Behavior
- Standard booking does not write quota consumption rows.
- Special quota / override booking writes `appointment_quota_consumptions`.
- On cancellation/reschedule/delete, active consumption records are marked `released_at`.
- Rebooking re-evaluates and creates fresh consumption records for new bucket/date.

## Migration Assumptions
- Additive schema only; legacy data remains valid.
- Date ranges are inclusive (`start_date` and `end_date`).
- Hard blocks remain non-overridable unless a rule explicitly sets `is_overridable=true`.
