# Doctor Portal Staging Validation

## Access Policy

- RISpro uses one login page. There is no separate Doctor Portal login.
- `DOCTOR_PORTAL_ENABLED=true` enables the module. `DOCTOR_PORTAL_AUTO_REDIRECT=true` is the default.
- After normal login, active Doctor Portal doctors auto-redirect to `/doctor/dashboard`.
- Users without an active doctor profile remain in RISpro Core.
- Core role `doctor` alone does not grant Doctor Portal clinical access.
- Inactive doctor profiles block clinical Doctor Portal access.
- `/api/doctor/me` reports Doctor Admin access separately from clinical Doctor Portal access.
- `super_admin` can access Doctor Portal Admin without a doctor profile, but is not rosterable unless a doctor profile exists.
- Core `supervisor` can manage doctor profiles in Doctor Portal Admin without having a doctor profile.
- RISpro Settings > Users manages core accounts only and shows read-only Doctor Portal status.

## User Management

1. Open Doctor Portal > Admin > Doctors.
2. Create doctor profiles for existing RISpro users.
3. Set doctor role, active state, report/protocol/supervisor permissions, and modality permissions.
4. Disable access by setting the doctor profile inactive. Do not delete historical rows.
5. Reactivate access by setting the doctor profile active.
6. Use CSV or XLSX import/export for bulk doctor setup. Export never includes passwords.
7. Imported new users are active immediately and must change temporary password on first login.

## Import / Export Workflow

1. Download the doctor import template.
2. Fill `username`, `full_name`, `temporary_password`, `core_role`, `doctor_role`, profile flags, and modality code lists.
3. Upload CSV or XLSX.
4. Inspect columns and row count.
5. Preview row actions and validation errors.
6. Confirm only when preview has no row-level errors.
7. Confirm writes users, profiles, modality permissions, and audit events transactionally.
8. New imports require first-login password change; existing user passwords change only when `reset_password=true`.

## Roster Planning

- Use Doctor Portal > Admin > Roster for supervisor/admin roster planning.
- Drag doctors into roster slots to add members.
- Dragging an existing member to another slot asks whether to move or copy.
- Backend APIs remain authoritative; failed drops show API errors/conflicts through existing query invalidation.
- The Add Member dropdown remains available as the non-drag fallback.
- Conflict warnings must be reviewed before publishing.
- Publishing is blocked when error-level conflicts exist.

## Manual Case Assignment

- Use Doctor Portal > Cases in supervisor/admin mode.
- Filter by date range, modality, assignment status, report requirement, and case category.
- Drag a case to a published roster target, then enter a correction reason.
- Use Assign/Reassign as the fallback when drag/drop is not convenient.
- A correction reason is required.
- Reassignment supersedes the previous active assignment and writes an audit event.
- Normal doctors cannot run assignment or reassignment.

## Workload Catalog

- Use Doctor Portal > Team Workload to review team workload totals.
- Doctor Admin can create, edit, and deactivate workload catalog rules.
- Rules configure team workload units by modality, optional exam, optional case category, and assignment type.
- Supervisors may view the catalog according to Doctor Portal permissions, but normal doctors cannot manage it.
- No individual productivity, salary, payment, revenue, or ranking views should appear.

## Protocol History

- Open a protocol task and review Protocol history.
- The timeline should show created, updated, assigned, clarification, cancelled, and corrected events when present.
- Confirm date/time, actor, reason, status, and version render without exposing raw internal JSON.
- Unrelated normal doctors must not be able to view protocol history.

## Forced Password Change

- New imported users get `must_change_password=true`.
- Users with the flag must change password before RISpro Core or Doctor Portal access.
- Successful password change clears the flag and refreshes the session.
- Existing users are not forced unless explicitly flagged.

## DB-Backed Validation Commands

Run with a real staging-like database:

```bash
TEST_DATABASE_URL=postgres://... node --import tsx --test src/modules/doctor-portal/doctor-portal.integration.test.ts
npm run typecheck
cd frontend && npx tsc --noEmit -p tsconfig.app.json
```

Also run focused Doctor Portal backend tests, frontend Doctor Portal tests, Settings Users tests, auth/login tests, and appointment routing/cutover tests.

## Staging Pilot Checklist

1. Set `DOCTOR_PORTAL_ENABLED=true`.
2. Set `DOCTOR_PORTAL_AUTO_REDIRECT=true`.
3. Apply migrations through the current release migration set.
4. Create or import test doctors using CSV and XLSX.
5. Confirm forced password change.
6. Set modality permissions.
7. Create a roster.
8. Test drag/drop roster planning and Add Member fallback.
9. Resolve conflicts and publish roster.
10. Create or select scheduled appointments.
11. Run assignment.
12. Drag/drop reassign one case with a reason.
13. Reassign one case using the Assign/Reassign fallback with a reason.
14. Save protocol draft and confirm draft is hidden from operational reads.
15. Assign protocol and confirm read-only visibility.
16. Review protocol history timeline.
17. Create/edit/deactivate workload catalog rules and rerun workload calculation.
18. Confirm workload remains team-based only.
19. Confirm normal doctor sees only own/team-allowed data.
20. Confirm supervisor/admin management works.
21. Confirm reception workflow is unchanged.
22. Monitor selected doctors, supervisors, and technologists for 1-2 weeks.

## Go / No-Go

GO for controlled staging pilot only if:

- DB-backed integration test runs and passes without skip after these code changes.
- Migrations apply cleanly.
- Forced password change works.
- CSV and XLSX import inspect/preview/confirm work.
- Modality permission UI works.
- Auto-redirect works.
- Drag/drop roster works with fallback controls.
- Drag/drop and fallback case reassignment work with audit.
- Workload catalog management works without individual productivity views.
- Protocol history timeline works with permission checks.
- Protocol drafts remain hidden from appointment/queue reads.
- Assigned protocols appear read-only.
- No duplicate active assignment/workload rows exist.
- Normal doctors cannot access unrelated data.
- Appointment routing/cutover tests pass.
- Typechecks pass.

These code changes require re-validation before production. Do not mark production complete until DB-backed validation has been rerun and the staging pilot has completed.

NO-GO if:

- DB-backed test skips.
- Migrations fail.
- Doctor without profile can enter clinical Doctor Portal pages.
- Inactive doctor can enter clinical Doctor Portal pages.
- Imported users can bypass forced password change.
- Protocol drafts appear in queue/appointment reads.
- Manual reassignment lacks audit.
- Normal doctor can reassign cases.
- Doctor Portal changes RISpro appointment scheduling/capacity behavior.

## Rollback / Disable

1. Set `DOCTOR_PORTAL_ENABLED=false` and restart the app.
2. Leave existing profiles, roster, protocols, assignments, and workload rows intact.
3. To block individual access, set the doctor profile inactive.
4. Keep RISpro Core scheduling, registration, booking, print, QR, and receptionist workflows unchanged.
