# Doctor Portal Roster Planning

Doctor Portal roster planning is team-based. It supports availability, leave, conflict checks, templates, draft generation, roster exports, and internal roster notification records.

## Boundaries

- RISpro Core remains authoritative for patients, appointments, scheduling, capacity, print, QR, and receptionist workflows.
- Generated rosters are drafts only and must be reviewed before publish.
- Exports and notifications contain roster data only. They must not include patient or appointment details.
- No payroll, salary, revenue, individual RVU ranking, or individual productivity scoring is implemented.

## Workflow

1. Doctors enter availability or request leave.
2. Supervisors review team availability and approve or reject leave.
3. Supervisors create a draft week manually, from a template, or through draft generation.
4. Conflict validation highlights unavailable doctors, leave, overlapping assignments, junior leads, missing specialists, and modality permission gaps.
5. Publish is blocked while error-level conflicts exist.
6. After publish, supervisors can create notification records for assigned doctors and export the roster.

## Limitations

- Notification records are internal audit-style records; email delivery is deferred.
- The generator uses conservative candidate selection and returns unfilled requirements instead of unsafe assignments.
- Template tables are implemented as `doctor_portal.roster_templates`, `roster_template_assignments`, and `roster_template_members`.
