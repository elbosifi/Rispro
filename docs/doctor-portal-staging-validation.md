# Doctor Portal Staging Validation

## Purpose

Validate Doctor Portal rollout without changing RISpro Core scheduling, capacity, registration, print, QR, or booking workflows.

## Prerequisites

- Run migrations through `071_doctor_portal_roster_notifications.sql`.
- Confirm `doctor_portal` schema exists.
- Set `DOCTOR_PORTAL_ENABLED=true` for staging validation. Leave unset to use the default enabled behavior.
- Keep RISpro Core appointment workflows enabled and unchanged.
- Use staging users only.

## Test Setup

1. Create one normal doctor user, one doctor supervisor, and one doctor admin.
2. Create active doctor profiles for each user.
3. Add modality permissions with `can_protocol=true` for the target modality.
4. Select or create a scheduled V2 appointment in staging.
5. Publish a roster week containing a matching roster assignment/team for the appointment date.
6. Add the normal doctor as a roster member.
7. Add one availability entry and one leave request for staging validation.

## Workflow Smoke Test

1. Log in as supervisor and publish the roster week.
2. Confirm availability entries and leave requests appear under Doctor Portal Availability.
3. Approve or reject a staging leave request as supervisor.
4. Add an unavailable doctor to a draft roster and confirm conflict warnings appear.
5. Confirm publish is blocked when error-level conflicts remain.
6. Resolve the conflict and publish successfully.
7. Apply a roster template to a draft week and confirm it does not publish automatically.
8. Generate a draft roster and confirm it remains draft.
9. Export the roster as HTML and CSV, confirming roster content only and no patient data.
10. Trigger roster notification records after publish and confirm only assigned doctors are included.
11. Run case assignment for the appointment date from Doctor Portal.
12. Confirm the appointment is assigned to the roster assignment/team, not to an individual doctor.
13. Log in as normal doctor and confirm the case appears in My Cases.
14. Open Protocols, save a draft, and confirm draft protocol is not visible in V2 appointment details or queue.
15. Assign the protocol.
16. Confirm assigned protocol fields are visible read-only in appointment details and queue reads.
17. Run workload calculation for the date range.
18. Confirm workload summary shows team, modality, case count, workload units, report-required count, no-report count, pending/finalized/overdue where available.

## Permission Checks

- Non-doctor cannot access Doctor Portal APIs.
- Normal doctor cannot mutate roster.
- Normal doctor cannot create team availability or approve leave.
- Normal doctor cannot run global case assignment.
- Normal doctor cannot run workload calculation.
- Normal doctor cannot generate draft rosters, notify teams, or export unrelated full rosters.
- Normal doctor cannot protocol unrelated cases.
- Supervisor can manage roster, run case assignment, protocol team cases, and calculate workload.
- Doctor admin can create catalog rules/profile records where enabled.

## Migration Verification

- Confirm migrations `064` through `071` applied in order.
- Confirm partial unique indexes:
  - `case_team_assignments_active_unique`
  - `case_workload_units_active_unique`
- Confirm availability/leave/template/notification tables:
  - `doctor_availability`
  - `doctor_leave_requests`
  - `roster_templates`
  - `roster_template_assignments`
  - `roster_template_members`
  - `doctor_roster_notifications`
- Confirm foreign keys to `appointments_v2.bookings`, `modalities`, `exam_types`, roster assignments, and doctor profiles.

## Rollback / Disable Procedure

1. Hide Doctor Portal navigation or disable access by removing active doctor profiles.
2. Set `DOCTOR_PORTAL_ENABLED=false` and restart the app to disable Doctor Portal API access.
3. Leave API permission checks in place.
4. Do not delete historical protocol, assignment, roster, or workload rows unless staging reset is intended.
5. If a migration rollback is required, remove dependent tables in reverse order: notifications, roster templates, availability/leave, workload, protocols, case assignments, roster, identity.

## Known Limitations

- Workload pending/finalized status uses existing booking status; no report finalization workflow is implemented.
- Workload catalog management is backend-only and minimal.
- Protocol audit history exists in the database but does not yet have a full timeline UI.
- Ultrasound session matching falls back safely when appointment data does not expose an explicit session signal.
- Roster notifications currently create internal records only; email delivery is deferred unless existing email infrastructure is explicitly wired later.
- Draft generation is conservative and review-only; it never publishes automatically.
