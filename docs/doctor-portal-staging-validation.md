# Doctor Portal Staging Validation

## Access Policy

- RISpro uses one login page. There is no separate Doctor Portal login.
- `DOCTOR_PORTAL_ENABLED=true` enables the module. `DOCTOR_PORTAL_AUTO_REDIRECT=true` is the default.
- After normal login, active Doctor Portal doctors auto-redirect to `/doctor/dashboard`.
- Users without an active doctor profile remain in RISpro Core.
- Core role `doctor` alone does not grant Doctor Portal clinical access.
- Inactive doctor profiles block clinical Doctor Portal access.
- `super_admin` can access Doctor Portal Admin without a doctor profile, but is not rosterable unless a doctor profile exists.
- Core `supervisor` can manage doctor profiles in Doctor Portal Admin without having a doctor profile.
- RISpro Settings > Users manages core accounts only and shows read-only Doctor Portal status.

## User Management

1. Open Doctor Portal > Admin > Doctors.
2. Create doctor profiles for existing RISpro users.
3. Set doctor role, active state, report/protocol/supervisor permissions, and modality permissions.
4. Disable access by setting the doctor profile inactive. Do not delete historical rows.
5. Reactivate access by setting the doctor profile active.
6. Use CSV import/export for bulk doctor setup. Export never includes passwords.
7. Imported new users are active immediately and must change temporary password on first login.

## Import / Export Workflow

1. Download the doctor import template.
2. Fill `username`, `full_name`, `temporary_password`, `core_role`, `doctor_role`, profile flags, and modality code lists.
3. Upload CSV.
4. Inspect columns and row count.
5. Preview row actions and validation errors.
6. Confirm only when preview has no row-level errors.
7. Confirm writes users, profiles, modality permissions, and audit events transactionally.

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
- Assign or reassign a case to a published roster slot.
- A correction reason is required.
- Reassignment supersedes the previous active assignment and writes an audit event.
- Normal doctors cannot run assignment or reassignment.

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
3. Create or import test doctors.
4. Confirm forced password change.
5. Set modality permissions.
6. Create a roster.
7. Test drag/drop roster planning and Add Member fallback.
8. Resolve conflicts and publish roster.
9. Create or select scheduled appointments.
10. Run assignment.
11. Manually reassign one case with a reason.
12. Save protocol draft and confirm draft is hidden from operational reads.
13. Assign protocol and confirm read-only visibility.
14. Run workload calculation and confirm team-based workload only.
15. Confirm normal doctor sees only own/team-allowed data.
16. Confirm supervisor/admin management works.
17. Confirm reception workflow is unchanged.
18. Monitor selected doctors, supervisors, and technologists for 1-2 weeks.

## Go / No-Go

GO for controlled staging pilot only if:

- DB-backed integration test runs and passes without skip.
- Migrations apply cleanly.
- Forced password change works.
- Import inspect/preview/confirm works.
- Modality permission UI works.
- Auto-redirect works.
- Drag/drop roster works with fallback controls.
- Manual case reassignment works with audit.
- Protocol drafts remain hidden from appointment/queue reads.
- Assigned protocols appear read-only.
- No duplicate active assignment/workload rows exist.
- Normal doctors cannot access unrelated data.
- Appointment routing/cutover tests pass.
- Typechecks pass.

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
