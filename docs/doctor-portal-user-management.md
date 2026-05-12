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

Doctor import is CSV only:

1. Download the template from Doctor Portal > Admin > Doctors.
2. Upload the completed CSV.
3. Inspect the CSV columns.
4. Preview row-level actions and errors.
5. Confirm valid imports.

New imported users are active immediately, receive the provided temporary password, and must change password on first login. Existing passwords are changed only when `reset_password=true`. Passwords are never included in doctor export CSV files.

## Modality Permissions

Each doctor profile can be granted per-modality permissions:

- `can_protocol`
- `can_report`
- `can_supervise`
- `active`

Roster and clinical workflow checks remain backend-authoritative.
