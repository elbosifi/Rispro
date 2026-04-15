# Appointments V2 — Staging Validation Runbook

This runbook is for operational validation of V2 in staging before production rollout. It assumes V2 code is deployed and the database migration has been applied.

---

## 1. Preflight Checks

Execute these before any manual testing:

```bash
# 1. Verify V2 migration applied
psql -c "SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'appointments_v2';"

# Expected: 12 tables listed

# 2. Verify published policy exists
psql -c "SELECT id, policy_set_key, version_number, status FROM appointments_v2.policy_versions WHERE status = 'published';"

# Expected: at least 1 row. If empty, V2 will return blocked for all dates.

# 3. Verify test user exists
psql -c "SELECT id, username, role FROM users WHERE role = 'supervisor' LIMIT 1;"

# 4. Verify server responds
curl -s http://localhost:3000/api/health
curl -s http://localhost:3000/api/ready
```

**Preflight Go**: Migration → 12 tables, published policy → exists, user → exists, health → 200

---

## 2. Shadow Soak Steps

Enable shadow mode and observe for at least one representative operational cycle:

```bash
# 1. Set shadow mode (choose one):
# Option A: environment variable
echo "APPOINTMENTS_V2_SHADOW_MODE_ENABLED=true" >> .env

# Option B: database setting
psql -c "INSERT INTO system_settings (category, setting_key, setting_value, updated_by_user_id) VALUES ('scheduling_and_capacity', 'appointments_v2_shadow_mode_enabled', '{\"value\":\"true\"}', (SELECT id FROM users WHERE role = 'supervisor' LIMIT 1)) ON CONFLICT (category, setting_key) DO UPDATE SET setting_value = '{\"value\":\"true\"}';"

# 2. Restart staging server
pm2 restart rispro  # or systemctl restart rispro

# 3. Generate shadow traffic
# Access /appointments page, select modality, create a few bookings

# 4. Monitor logs for shadow output
tail -f staging.log | grep -E "shadow_diff|shadow_summary"

# Expected: JSON lines with type "shadow_diff" and "shadow_summary" appear
```

**Shadow Soak Go**: Shadow logs emit within 1 cycle. No user-visible response change. Mismatch rate acceptable (< 5% as baseline).

**Shadow Soak No-Go**: Shadow logs missing, or mismatch rate > 20%, or response visibly different.

---

## 3. Receptionist Manual Scenario Pack

Execute each scenario, record evidence, verify outcome.

### 3.1 Scenario: Normal Booking

**Steps**:
1. Navigate to `/appointments`
2. Select modality (e.g., CT)
3. Select available date
4. Search existing patient or register new
5. Submit booking

**Expected**: Booking created, appears in bookings list with status `confirmed`

**Evidence**: Booking ID returned, status `confirmed` in list

### 3.2 Scenario: Blocked Dates

**Steps**:
1. Admin config: set blocked date for selected modality (via policy in Settings)
2. Refresh availability page
3. Attempt booking on blocked date

**Expected**: Date shows `blocked` badge. Booking returns 409 with "blocked" reason.

**Evidence**: Status badge visible, API returns 409

### 3.3 Scenario: Restricted / Override-Required Dates

**Steps**:
1. Admin config: set `restriction_overridable` for modality/date range (via policy in Settings)
2. Refresh availability page
3. Attempt booking on restricted date without override

**Expected**: Date shows `restricted` badge. Booking without override fails with override required.

**Evidence**: Status badge visible, override dialog appears

### 3.4 Scenario: Override Success

**Steps**:
1. On restricted date, open override dialog
2. Enter supervisor credentials
3. Provide override reason
4. Submit booking

**Expected**: Booking created with status `confirmed`, override audit logged

**Evidence**: Booking created, override_audit_events contains record with outcome `approved_and_booked`

### 3.5 Scenario: Override Rejection

**Steps**:
1. On restricted date, open override dialog
2. Enter invalid supervisor credentials
3. Attempt submit

**Expected**: Override rejected, booking not created

**Evidence**: Error message displayed, no booking record created

### 3.6 Scenario: Special Quota Create

**Steps**:
1. Admin config: set special quota for exam type (via policy in Settings)
2. Verify quota available: check `appointments_v2.exam_type_special_quotas`
3. Create booking for exam type with special quota

**Expected**: Booking consumes special quota (quota remaining decremented)

**Evidence**: `quota_remaining` decreased by 1

### 3.7 Scenario: Special Quota Exhaust

**Steps**:
1. Create bookings until special quota reaches 0
2. Attempt another booking for same exam type

**Expected**: Quota exhausted, date shows `restricted` or capacity exhausted, booking rejected

**Evidence**: Quota shows 0, booking returns 409 with "quota exhausted"

### 3.8 Scenario: Cancel Release

**Steps**:
1. Create booking (consumes capacity/quota)
2. Cancel the booking
3. Verify capacity/quota released

**Expected**: Booking status `cancelled`, capacity released, quota restored

**Evidence**: Booking status `cancelled`, quota_remaining restored, available slots freed

### 3.9 Scenario: Reschedule Behavior

**Steps**:
1. Create existing booking
2. Open reschedule dialog
3. Select new available date
4. Submit reschedule

**Expected**: Old booking cancelled, new booking created, new booking has different ID (audit trail)

**Evidence**: Two bookings — old status `cancelled`, new status `confirmed`

### 3.10 Scenario: Cancel Guard (Cancelled/No-Show)

**Steps**:
1. Find booking with status `cancelled` or `no-show`
2. Attempt to cancel again

**Expected**: Rejected with 409

**Evidence**: API returns 409, error message about non-cancellable status

### 3.11 Scenario: Print/Details Post-Create Flow

**Steps**:
1. Create booking
2. Navigate to Print/Details page
3. Enter visit details
4. Submit

**Expected**: Visit details saved, confirmation shown

**Evidence**: Visit record created, print view renders correctly

### 3.12 Scenario: Priority Persistence

**Steps**:
1. Create booking with priority indicator
2. Retrieve booking details

**Expected**: Priority field preserved in booking record

**Evidence**: `priority` field in appointments_v2.bookings matches input

### 3.13 Scenario: Walk-in Persistence

**Steps**:
1. Walk-in: mark booking as walk-in
2. Query booking list

**Expected**: Walk-in flag preserved

**Evidence**: `is_walk_in` field in booking matches input

---

## 4. Concurrency / Race Validation

Test that concurrent operations do not cause overbooking or silent failures:

```bash
# Setup: find date with 1 remaining slot
# Terminal 1: create booking for same date simultaneously
# Terminal 2: create booking for same date simultaneously

# Verify:
# - Exactly 1 booking succeeds (200)
# - Other returns 409 with retryable error (409 capacity conflict)
# - No overbooking (total bookings <= capacity)
```

**Race Validation Go**: First succeeds (200), second fails (409), no overbooking

**Race Validation No-Go**: Both succeed (overbooking), or both fail with 500 (server error)

---

## 5. Evidence Recording

For each scenario, record in validation log:

| Scenario | Pass/Fail | Booking ID | Evidence Type | Notes |
|----------|-----------|------------|---------------|-------|
| Normal booking | Pass/Fail | xxx | Screenshot / API response | |
| Blocked dates | Pass/Fail | — | Badge screenshot | |
| Override success | Pass/Fail | xxx | DB query override_audit | |
| ... | | | | |

Upload screenshots and DB queries to validation evidence folder.

---

## 6. Go / No-Go Criteria

### Go Criteria

- [ ] Preflight: migration applied, policy published, user exists
- [ ] Shadow soak: logs emit < 1 cycle, no response change
- [ ] All 13 manual scenarios: Pass
- [ ] Race validation: No overbooking, proper conflict handling
- [ ] Shadow behavior remains non-user-visible

### No-Go Criteria

- Any preflight check fails
- Shadow logs missing for 2 cycles
- Any manual scenario fails (after admin fix attempts)
- Overbooking observed in race test
- User sees shadow response artifacts

---

## 7. Rollback / Fallback Instructions

### Immediate Fallback Path

1. **Disable V2 routing without code change**:
   - Access server routing config
   - Change `/appointments` to serve legacy path (current routing uses V2 at `/appointments`, legacy at separate route)

2. **Or disable shadow mode** (if V2 routing is active but shadow mode is the concern):
   - Remove `APPOINTMENTS_V2_SHADOW_MODE_ENABLED=true` from `.env`
   - Remove DB setting: `DELETE FROM system_settings WHERE setting_key = 'appointments_v2_shadow_mode_enabled';`
   - Restart server

3. **Verify fallback**:
   - Access `/appointments` — should render legacy UI
   - Create test booking — should use legacy backend

### Code Rollback (later escalation only)

Only if fallback path above does not resolve the issue:

1. Restore previous code commit: `git revert HEAD` or checkout previous tag
2. Restore previous migration state if schema changed
3. Restart server
4. Verify legacy functionality

---

## 8. Quick Reference Commands

```bash
# Check V2 tables
psql -c "SELECT tablename FROM pg_tables WHERE schemaname = 'appointments_v2';"

# Check published policy
psql -c "SELECT id, policy_set_key, version_number FROM appointments_v2.policy_versions WHERE status = 'published';"

# Check bookings
psql -c "SELECT id, patient_national_id, booking_date, status FROM appointments_v2.bookings ORDER BY created_at DESC LIMIT 10;"

# Check override audit
psql -c "SELECT id, booking_id, supervisor_user_id, outcome, reason FROM appointments_v2.override_audit_events ORDER BY created_at DESC LIMIT 10;"

# Check special quota
psql -c "SELECT exam_type_id, quota_remaining, quota_total FROM appointments_v2.exam_type_special_quotas;"

# Enable shadow mode (DB)
psql -c "INSERT INTO system_settings (category, setting_key, setting_value, updated_by_user_id) VALUES ('scheduling_and_capacity', 'appointments_v2_shadow_mode_enabled', '{\"value\":\"true\"}', (SELECT id FROM users WHERE role = 'supervisor' LIMIT 1)) ON CONFLICT (category, setting_key) DO UPDATE SET setting_value = '{\"value\":\"true\"}';"
```

---

*Last updated: April 16, 2026. Based on current code state: 667 unit tests + 44 integration tests pass, shadow route E2E passes, suite-scoped DB isolation complete.*