# Appointments V2 — Cutover Checklist

## Current status

- **Backend**: ✅ Complete (Stages 2-8) — scaffold, schema, decision engine, availability APIs, transactional booking, admin policy versioning, shadow mode
- **Frontend**: ✅ Complete (Stage 9) — types, API hooks, availability page, status badge
- **Route wiring**: ✅ Complete (Stage 10) — V2 page accessible at `/v2/appointments`
- **Tests**: ✅ 109/109 pass, 0 TypeScript errors (backend + frontend)

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
| Admin: create draft | ✅ | `POST /api/v2/scheduling/admin/policy/draft` |
| Admin: save draft | ✅ | `PUT /api/v2/scheduling/admin/policy/draft/:id` |
| Admin: publish | ✅ | `POST /api/v2/scheduling/admin/policy/draft/:id/publish` |
| Admin: preview impact | ✅ | `GET /api/v2/scheduling/admin/policy/draft/:id/preview` |
| Frontend: availability page | ✅ | `/v2/appointments` |
| Shadow mode | ✅ | `SHADOW_MODE_ENABLED=true` env var |

## What is NOT yet implemented

| Component | Status | Notes |
|---|---|---|
| Booking creation UI | ⚠️ API hooks exist, no form UI | Patient selection, date picker, override dialog |
| Admin policy UI | ⚠️ Backend endpoints exist, no form UI | Draft/publish/preview components |
| Reschedule UI | ⚠️ API hook exists, no form UI | Reschedule form with date/time picker |
| Cancel UI | ⚠️ API hook exists, no button | Cancel button with confirmation |
| `examTypeRuleItemExamTypeIds` | ⚠️ Not populated from DB | Exam rules evaluate without many-to-many join |
| `dailyCapacity` default | ⚠️ Hardcoded to 20 | Should come from modality configuration |
| Integration tests | ⚠️ Unit tests only | No real PostgreSQL test database |

## Pre-deployment steps

- [ ] **Run migration**: `npm run migrate` (applies `023_appointments_v2_schema.sql`)
- [ ] **Seed supervisor**: `npm run seed:supervisor` (if not already done)
- [ ] **Verify DB**: `SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'appointments_v2';` — should show 12 tables
- [ ] **Test API**: `curl -s http://localhost:3000/api/v2/scheduling/availability?modalityId=1&days=7&caseCategory=non_oncology` — should return JSON
- [ ] **Enable shadow mode** (optional): Set `SHADOW_MODE_ENABLED=true` in `.env`
- [ ] **Review shadow diffs**: Monitor stdout for `{"type":"shadow_diff"}` and `{"type":"shadow_summary"}` entries

## Post-deployment validation

- [ ] Visit `/v2/appointments` — page should load with modality selector
- [ ] Select a modality — availability table should appear with status badges
- [ ] Create a booking via API — verify booking appears in DB
- [ ] Cancel the booking — verify status changes to `cancelled`
- [ ] Review shadow diff output (if enabled) — check mismatch rate
- [ ] Compare V2 decisions with legacy availability for same modality/date range

## Known risks

1. **No published policy**: V2 endpoints return empty/blocked if no policy version is published. Admin must create and publish a policy first.
2. **Legacy tables not modified**: V2 uses its own tables. Legacy appointments continue to work independently.
3. **Capacity defaults**: When no category daily limit is configured, capacity defaults to 20 — this may differ from legacy behavior.
4. **Exam rule matching**: Exam type rules evaluate without the `exam_type_rule_items` join — rules apply to all exam types for the modality, not specific ones.

## Rollback plan

- V2 is isolated under `src/modules/appointments-v2/` and `/api/v2/`.
- If V2 causes issues, simply remove the `/api/v2` route registration in `src/app.ts` — no legacy code is affected.
- The migration is additive-only — rolling back requires dropping the `appointments_v2` schema.
- Frontend V2 is isolated under `frontend/src/v2/appointments/` — removing the route in `App.tsx` hides the page.
