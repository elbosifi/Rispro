# Reporting Assignment Board Staging Validation

Use this runbook after deploying Reporting Assignment Board changes to staging and before enabling broader clinical rollout.

## Preflight

1. Back up the staging database before applying migrations.
2. Run migrations through `089_reporting_priority_default_order.sql`.
3. Confirm `DOCTOR_PORTAL_ENABLED=true` and normal Doctor Portal access still works.
4. Confirm SonicDICOM report status settings are configured. If SonicDICOM is intentionally unavailable in staging, expect normalized `unavailable` statuses and verify the board does not crash.
5. Confirm CT and MR modalities exist and use codes `CT` and `MR`.
6. Confirm reporting priorities sort as `stat`, `urgent`, `routine`, then no priority.
7. Confirm active doctor profiles exist for test users.
8. Confirm reporting target doctors have `canFinalizeReports=true` and active `canReport` modality permissions for CT/MR.

## Role Checks

1. Confirm `super_admin` can open Reporting Board settings and edit cutoff/default settings.
2. Confirm supervisor or Doctor Portal admin can open `/doctor/reporting-board`, list cases, assign one case, and run bulk next-N assignment.
3. Confirm a normal doctor can open their own authenticated saved-view link when product rules allow it.
4. Confirm a normal doctor cannot bulk assign or manage Reporting Board settings.
5. Confirm unauthenticated requests cannot access `/doctor/reporting-board`, `/print/reporting-board`, saved-view token routes, or Reporting Board APIs.

## Case-List Checks

1. Open the board with no filters and confirm defaults show only report-required, not-final CT/MR cases.
2. Confirm final reports are excluded by default.
3. Confirm `draft`, `no_report`, `study_not_found`, and `unavailable` report statuses are included by default.
4. Confirm cancelled, discontinued, and voided cases are excluded.
5. Confirm category filter works for oncology and non-oncology.
6. Confirm assigned doctor filter works for all, unassigned, and a selected doctor.
7. Confirm priority chips render expected colors: STAT danger, urgent warning, routine neutral, unknown/missing muted or neutral.
8. Confirm report status chips render normalized statuses only: `final`, `draft`, `no_report`, `study_not_found`, `unavailable`.

## Saved View Checks

1. Create a saved view from current filters.
2. Open its authenticated saved token link and confirm the filters and cases load.
3. Update saved-view notification toggles, especially `notifyAssignedToMe`, and confirm they persist.
4. Deactivate the saved view.
5. Confirm the inactive token no longer loads as active and does not expose cases.

## Assignment Checks

1. Single-row assign a case and confirm `case_team_assignments` updates correctly.
2. Confirm single-row assignment writes Doctor Portal audit.
3. Reassign a case and confirm a reason is required if the workflow requires it.
4. Seed or select enough eligible unassigned cases, then bulk assign next N.
5. Confirm bulk next-N assigns exactly the requested number when enough eligible cases exist.
6. Confirm bulk ordering is priority sort order, booking date, booking time with nulls first, then appointment id.
7. Confirm already assigned cases are skipped when `unassignedOnly=true`.
8. Confirm final, cancelled, discontinued, voided, and report-not-required cases are not assigned by default.
9. Confirm target doctor must have `canFinalizeReports=true`.
10. Confirm target doctor must have active report permission for every selected modality.

## Notification Checks

1. Enable `notifyAssignedToMe` on an active saved view owned by the target doctor.
2. Assign a reporting case to that doctor and confirm exactly one in-app notification is created.
3. Repeat the same assignment path and confirm dedupe prevents a duplicate notification for the same saved view, doctor, and appointment.
4. Confirm notification title/body contain no patient name, accession number, diagnosis, report text, or clinical detail.
5. Click the notification and confirm it opens the Reporting Board or saved view.
6. Confirm read, dismiss, and read-all only affect the current user's notifications.

## Print Checks

1. Print the current board filter from `/print/reporting-board`.
2. Print from a saved view token and confirm saved-view filters are preserved.
3. Print a doctor handoff list and confirm assigned doctor filtering is preserved.
4. Confirm `autoprint=1` waits until case data is loaded.
5. Confirm printed output includes generated time, cutoff date, filter or saved-view name, total count, and case rows.
6. Confirm printed columns are clinically useful and paper-friendly: priority, patient name, MRN, accession, appointment date/time, modality, exam, category, assigned doctor, report status, and notes/signature.

## Go / No-Go

GO only if:

- All checks pass.
- Migrations through `089` are applied.
- DB-backed Reporting Board integration tests pass without skip against staging or staging-like PostgreSQL.
- No unexpected 5xx errors occur.
- No unauthorized access is possible.
- No wrong-doctor assignment occurs.
- Notifications do not leak patient data or clinical details.
- Print handoff is acceptable to clinical admin.

NO-GO if:

- Assignment ordering is wrong.
- Final, cancelled, discontinued, voided, or report-not-required cases appear in the default list.
- Saved tokens expose data incorrectly.
- Notifications leak patient details.
- Bulk assignment can assign to a doctor without modality/report permission.
- Print route exposes patient data without authentication.
