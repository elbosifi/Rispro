# Appointments V2 — Cutover Checklist

## Current status (April 16, 2026)

- **Backend**: ✅ Complete (Stages 2–8) — scaffold, schema, decision engine, availability APIs, transactional booking, admin policy versioning, shadow mode
- **Frontend**: ✅ Complete (Stage 8/9) — types, API hooks, availability page, booking form, bookings list, cancel + reschedule UI, status badge
- **Route wiring**: ✅ Complete — V2 page accessible at `/v2/appointments`
- **Tests**: ✅ 667 V2 unit tests + 44 integration tests (100% pass individually); parallel execution works — suite-scoped DB data eliminates shared-data conflicts. Shadow route E2E passes.
- **TypeScript**: ✅ 0 errors in frontend and V2 backend (legacy `dicom.ts` has unrelated errors)

## Bug fixes applied during integration testing (April 12, 2026)

The following bugs were discovered and fixed while running integration tests against real PostgreSQL:

| Bug | Fix | File |
|---|---|---|
| Availability for non-existent modality returned 200 (empty) instead of 400 | Added modality existence check in route handler | `scheduling-v2-routes.ts` |
| `getNextVersionNumber` SQL returned column `next_version` but TypeScript expected `nextVersion` — always defaulted to 1 | Aliased SQL column as `"nextVersion"` | `admin-policy.repo.ts` |
| `publishPolicy` tried to publish BEFORE archiving old published versions, causing unique constraint violation | Reordered: archive old published versions first, then publish | `publish-policy.service.ts` |
| Integration test `seedTestData` had duplicated code block (copy-paste error) | Removed duplicate, simplified to direct INSERT with hardcoded version_no=1 | `helpers.ts` |
| Integration test patient national ID was 11 chars (constraint requires 12) | Fixed UUID slice to produce 11 digits after prefix `1` | `helpers.ts` |
| Integration test cleanup failed on FK `system_settings.updated_by_user_id` | NULL out FK reference before deleting test users | `helpers.ts` |
| Integration test "reject publishing non-draft" expected 400 but service correctly returns 409 | Fixed test expectation to 409 | `availability-flow.test.ts` |

## What is ready

| Component | Status | Endpoint / Path |
|---|---|---|
| Backend scaffold | ✅ | `src/modules/appointments-v2/` |
| V2 DB schema | ✅ | Migration `023_appointments_v2_schema.sql` |
| Decision engine | ✅ | `pureEvaluate()` — all 7 D008 steps |
| Availability API | ✅ | `GET /api/v2/scheduling/availability` |
| Suggestions API | ✅ | `GET /api/v2/scheduling/suggestions` |
| Evaluate API | ✅ | `POST /api/v2/scheduling/evaluate` |
| Create booking | ✅ | `POST /api/v2/appointments` |
| Reschedule booking | ✅ | `PUT /api/v2/appointments/:id` |
| Cancel booking | ✅ | `POST /api/v2/appointments/:id/cancel` |
| List bookings | ✅ | `GET /api/v2/appointments` |
| Admin: create draft | ✅ | `POST /api/v2/scheduling/admin/policy/draft` |
| Admin: save draft | ✅ | `PUT /api/v2/scheduling/admin/policy/draft/:id` |
| Admin: publish | ✅ | `POST /api/v2/scheduling/admin/policy/draft/:id/publish` |
| Admin: preview impact | ✅ | `GET /api/v2/scheduling/admin/policy/draft/:id/preview` |
| Frontend: availability page | ✅ | `/v2/appointments` |
| Frontend: booking form | ✅ | Patient search, date picker, override dialog, submit |
| Frontend: bookings list | ✅ | Recent bookings table with cancel + reschedule buttons |
| Frontend: cancel UI | ✅ | `CancelConfirmDialog` with toast feedback |
| Frontend: reschedule UI | ✅ | `RescheduleDialog` with pre-evaluation + override support |
| Shadow mode | ✅ | `SHADOW_MODE_ENABLED=true` env var |
| dailyCapacity from modality config | ✅ | T014 — falls back to `modalities.daily_capacity` |
| examTypeRuleItemExamTypeIds from DB | ✅ | T012 — populated from `exam_type_rule_items` join table |

## Pre-deployment steps

- [ ] **Run migration**: `npm run migrate` (applies all pending migrations including `023_appointments_v2_schema.sql`)
- [ ] **Seed supervisor**: `npm run seed:supervisor` (if not already done)
- [ ] **Verify DB**: `SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'appointments_v2';` — should show 12 tables
- [ ] **Test API**: `curl -s http://localhost:3000/api/v2/scheduling/availability?modalityId=1&days=7&caseCategory=non_oncology` — should return JSON
- [ ] **Publish a policy**: Use admin endpoints to create, save, and publish a scheduling policy (V2 returns empty/blocked without one)
- [ ] **Enable shadow mode** (optional): Set `APPOINTMENTS_V2_SHADOW_MODE_ENABLED=true` in `.env` (or `SHADOW_MODE_ENABLED=true` as legacy fallback)
- [ ] **Review shadow diffs**: Monitor stdout for `{"type":"shadow_diff"}` and `{"type":"shadow_summary"}` entries

## Post-deployment validation

- [ ] Visit `/v2/appointments` — page should load with modality selector
- [ ] Select a modality — availability table should appear with status badges
- [ ] Search for a patient and create a booking — verify booking appears in bookings list
- [ ] Cancel a booking — verify status changes to `cancelled` and capacity is freed
- [ ] Reschedule a booking — verify new booking created on new date, old booking cancelled
- [ ] Review shadow diff output (if enabled) — check mismatch rate
- [ ] Compare V2 decisions with legacy availability for same modality/date range

## Known risks

1. **No published policy**: V2 endpoints return empty/blocked if no policy version is published. Admin must create and publish a policy first.
2. **Legacy tables not modified**: V2 uses its own tables. Legacy appointments continue to work independently.
3. **Reschedule creates new booking ID**: The reschedule flow cancels the old booking and inserts a new one with a different ID (correct for audit trail). Downstream consumers holding the old ID need to use the returned new booking ID.
4. **dailyCapacity = 0**: Modalities with `daily_capacity = 0` in the `modalities` table will show zero remaining capacity. Configure reasonable defaults per modality.
5. **Legacy service tests**: 27 legacy service tests fail (`src/services/*.test.ts`) due to pre-existing SQL type inference issues and availability logic bugs. These are unrelated to V2.
6. **Shadow soak required**: Shadow mode must be monitored for at least one representative cycle before production enablement. See STAGING_VALIDATION_RUNBOOK.md.

## Rollback plan

- V2 is isolated under `src/modules/appointments-v2/` and `/api/v2/`.
- If V2 causes issues, simply remove the `/api/v2` route registration in `src/app.ts` — no legacy code is affected.
- The migration is additive-only — rolling back requires dropping the `appointments_v2` schema.
- Frontend V2 is isolated under `frontend/src/v2/appointments/` — removing the route in `App.tsx` hides the page.

---

*Last updated: April 12, 2026. Based on TASK_LEDGER.md entries T001–T015 and current code state.*
