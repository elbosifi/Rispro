# Doctor Portal Production Rollout

Status: not production-complete after the latest Doctor Portal feature changes. DB-backed validation must be rerun and the staging pilot is still required before production.

## Production Configuration

- `DOCTOR_PORTAL_ENABLED=true`
- `DOCTOR_PORTAL_AUTO_REDIRECT=true`
- `DATABASE_URL` points to the production PostgreSQL database.
- `JWT_SECRET` is production-only and at least 32 characters.
- `COOKIE_SECURE=true` behind HTTPS.
- `TRUST_PROXY=1` when behind the production reverse proxy.

## Backup and Migration

1. Put the release window on the clinical calendar.
2. Take a verified PostgreSQL backup before deploying:
   `pg_dump --format=custom --file=rispro-pre-doctor-portal.dump "$DATABASE_URL"`.
3. Record the current application commit and migration state:
   `select filename, applied_at from schema_migrations order by filename;`
4. Deploy the application build.
5. Run migrations through `072_users_must_change_password.sql`:
   `npm run migrate`.
6. Verify `schema_migrations` contains migrations `064` through `072`.
7. Verify `users.must_change_password` and `users_must_change_password_idx` exist.

## Rollback / Disable

- Fast disable: set `DOCTOR_PORTAL_ENABLED=false` and restart.
- Keep migrated tables in place; do not drop clinical history during rollback.
- If login friction occurs, admin-reset affected users' passwords from Settings > Users.
- If doctor access must be blocked individually, set the doctor profile inactive in Doctor Portal Admin.
- Restore the pre-release database backup only if core RISpro data is corrupted and clinical leadership approves data loss from the release window.

## Go-Live Checklist

- Backend Doctor Portal tests pass.
- Frontend Doctor Portal tests pass.
- Appointment routing/cutover tests pass.
- Backend and frontend typechecks pass.
- DB-backed Doctor Portal integration test passes against staging or production-like DB.
- CSV and XLSX import inspect, preview, and confirm work.
- CSV remains supported as the fallback import/export format.
- XLSX export excludes passwords and password hashes.
- Imported users must change password and cannot access APIs before changing it.
- Profileless `super_admin`/`supervisor` can use Doctor Admin only.
- Profileless admins cannot access clinical roster, cases, protocols, workload, or availability.
- Drag/drop roster and Add Member fallback both work.
- Roster publish blocks error conflicts.
- Drag/drop case reassignment requires a reason and writes audit.
- Assign/Reassign fallback requires a reason and writes audit.
- Protocol drafts remain hidden from core appointment and queue reads.
- Protocol history timeline shows safe read-only audit summaries.
- Workload catalog create/edit/deactivate works for Doctor Admin without individual productivity, salary, payment, revenue, or ranking features.

## Monitoring and Audit

- Review `/api/health` and `/api/ready` after deploy.
- Watch application logs for 4xx/5xx spikes under `/api/doctor`.
- Review audit entries for doctor import, profile changes, roster publish blocks, case reassignment, password changes, and supervisor re-auth.
- Review protocol history for assigned/corrected protocol events.
- Review workload catalog changes before recalculating workload.
- Check for duplicate active rows:
  - `doctor_portal.case_team_assignments` by `(appointment_id, assignment_type)` where `status='active'`.
  - `doctor_portal.case_workload_units` by appointment/assignment where `status='active'`.

## No-Go Conditions

- Any migration fails or is skipped.
- DB-backed integration cannot run on a staging-like database.
- Imported users can access clinical APIs before changing password.
- Profileless admins can access clinical Doctor Portal routes.
- Manual reassignment can create duplicate active assignments.
- Drag/drop assignment bypasses reason capture or backend reassignment.
- XLSX import bypasses inspect/preview/confirm.
- Workload catalog exposes individual doctor productivity, salary, payment, revenue, or ranking.
- Protocol history exposes raw internal JSON or unrelated doctor access.
- Roster publish succeeds with error-level conflicts.
- Doctor Portal changes core scheduling, capacity, registration, print, PACS, or queue behavior unexpectedly.

## Post-Launch Support

- Keep a named engineer and clinical owner on call for the first production week.
- Review audit and error logs daily for the first week.
- Collect doctor, supervisor, technologist, and reception feedback after each day.
- Prefer disabling Doctor Portal over database rollback for isolated workflow issues.

## Re-Validation Required

The feature changes for XLSX import/export, drag/drop case assignment, workload catalog management, and protocol history require a fresh validation run. Do not claim production validation passed from commit `1269ee4421a3ef66dc785f99662c5815406fd8e4`; rerun DB-backed Doctor Portal validation, frontend tests, typechecks, appointment routing regression, and guardrail tests after deploying these changes to staging.
