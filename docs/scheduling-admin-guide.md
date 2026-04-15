# Scheduling Admin Guide

## Purpose
Use **Settings -> Scheduling Engine Config** to manage:
- daily category limits
- blocked modality dates
- exam schedule restriction rules
- special quotas
- special reason codes
- patient identifier types

## Section Rules

### Category Daily Limits
- Set one row per `modalityId + caseCategory`.
- `caseCategory` is `oncology` or `non_oncology`.
- `dailyLimit` is per modality, per day, per category.

### Modality Blocked Rules
- `specific_date`: block one exact date.
- `date_range`: block inclusive `startDate` and `endDate`.
- `yearly_recurrence`: use recurrence month/day fields.
- Hard blocks are non-overridable unless `isOverridable` is enabled.

### Exam Schedule Restriction Rules
- `ruleType`: `specific_date`, `date_range`, `weekly_recurrence`.
- `effectMode`:
  - `hard_restriction`
  - `restriction_overridable`
- `examTypeIdsCsv`: comma-separated exam type ids (example: `4, 7, 9`).
- Weekly recurrence uses `weekday` (`0` Sunday to `6` Saturday).

### Special Quotas
- `examTypeId` + `dailyExtraSlots`.
- Applies after standard category capacity is exhausted.

### Special Reason Codes
- Used when booking with special quota.
- `code` must be unique and stable.

### Patient Identifier Types
- Defines allowed identifier types for registration multi-identifier UI.
- Keep default core types active unless intentionally deprecated.

## Operational Recommendations
- Start with shadow mode enabled: set `APPOINTMENTS_V2_SHADOW_MODE_ENABLED=true` (or legacy fallback `SHADOW_MODE_ENABLED=true`)
- Shadow mode logs comparisons via `{"type":"shadow_diff"}` and `{"type":"shadow_summary"}` — review before production enablement
- Review audit and override events before enforcing full blocking
- V2 routing: `/appointments` already serves V2; legacy fallback remains available separately

## Validation Expectations
- Availability and suggestions are backend rule-aware.
- Final create/update re-validates in transaction.
- Override attempts are always audited.
