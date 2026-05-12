# Doctor Portal User Management

Doctor Portal uses normal RISpro user accounts for authentication. A user becomes a clinical Doctor Portal user only when Doctor Portal Admin creates an active doctor profile for that account.

## Rules

- Use RISpro Settings > Users for core account creation, password reset, role, and delete behavior.
- Use Doctor Portal > Admin > Doctors for doctor profiles, doctor roles, active/inactive access, and modality permissions.
- Core role `doctor` is not enough for Doctor Portal access.
- Inactive doctor profiles block clinical access.
- `super_admin` and core `supervisor` can manage doctor profiles.
- `super_admin` without a profile can manage Doctor Portal Admin but is not rosterable.

## Bulk Import

Doctor import supports CSV and XLSX:

1. Download the template from Doctor Portal > Admin > Doctors.
2. Choose either the CSV template or the XLSX template.
3. Upload the completed CSV or XLSX file.
4. Inspect the columns.
4. Preview row-level actions and errors.
5. Confirm valid imports.

CSV remains supported as the simple fallback. New imported users are active immediately, receive the provided temporary password, and must change password on first login. Existing passwords are changed only when `reset_password=true`. Passwords and password hashes are never included in CSV or XLSX doctor exports.

## Related Admin Workflows

- Cases: supervisors/admins can drag a case to a published roster target or use the Assign/Reassign fallback. Both paths require a correction reason before the backend saves reassignment and audit.
- Workload catalog: Doctor Admin can configure team workload units by modality, exam, category, and assignment type. This is team workload only; salary, payment, revenue, and individual productivity ranking are not part of Doctor Portal.
- Protocols: eligible doctors and supervisors/admins can view the read-only Protocol history timeline for a case.

## Modality Permissions

Each doctor profile can be granted per-modality permissions:

- `can_protocol`
- `can_report`
- `can_supervise`
- `active`

Roster and clinical workflow checks remain backend-authoritative.
