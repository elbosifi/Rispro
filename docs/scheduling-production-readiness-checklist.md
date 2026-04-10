# Scheduling Production Readiness Checklist

## Must Pass Before Go-Live
- [ ] CI workflow `CI` passes on target commit.
- [ ] Deploy workflow `validate` passes on target commit.
- [ ] DB migrations apply successfully in staging and production.
- [ ] Scheduling integration tests pass against real PostgreSQL.
- [ ] Frontend production build passes.

## Functional Gates
- [ ] Availability endpoint decisions match evaluator outputs.
- [ ] Suggestions endpoint decisions match evaluator outputs.
- [ ] Final create/update booking re-validates in transaction.
- [ ] Race conflicts return retryable responses (no silent overbooking).
- [ ] Special quota consumption/release behavior validated on create/cancel/reschedule.
- [ ] Override outcomes audited for:
  - approved_and_booked
  - approved_but_failed
  - denied
  - cancelled

## Rollout Strategy
- [ ] `scheduling_engine_shadow_mode=enabled`.
- [ ] `scheduling_engine_enabled=disabled` during shadow period.
- [ ] Review shadow/audit logs for at least one representative cycle.
- [ ] Validate reception/supervisor workflows with real users.
- [ ] Enable `scheduling_engine_enabled` in controlled rollout.
- [ ] Monitor override frequency and blocked reason patterns post-enable.

## Operational Safeguards
- [ ] Backup confirmed before enabling strict enforcement.
- [ ] Rollback procedure documented and tested.
- [ ] On-call owner assigned for first production window.
- [ ] Post-rollout review completed and signed off.
