# Patient Import V1 (Staging Workflow)

## Purpose
Patient import V1 provides a simple, production-safe Excel import path using a staging review step before writing to live `patients`.

## Supported Excel Format (V1)
- One workbook upload per run.
- One sheet per run (defaults to first sheet unless another sheet is selected).
- Required mapped columns:
  - Arabic full name
  - National ID
- Optional mapped column:
  - Phone

## Workflow
1. Upload Excel file.
2. Select sheet (if needed).
3. Map columns for Arabic full name, national ID, and optional phone.
4. Run preview import to staging.
5. Review staged rows with validation status.
6. Select valid non-duplicate rows.
7. Confirm migration to live `patients`.

## Validation Rules (V1)
- Arabic full name is required.
- National ID is required.
- National ID must be exactly 12 digits.
- If `phone1_required` is active in `patient_registration` settings, phone is required and must be 10 digits.

## Transformations
For each staged row:
- Arabic name is preserved.
- English name is generated using existing RISpro dictionary transliteration logic.
- National ID is normalized to digits.
- Phone is normalized to digits.
- Sex and DOB/age are derived from national ID using existing RISpro national-ID logic.

## Duplicate Behavior
- Duplicate detection is exact by national ID against live `patients`.
- Duplicates are marked as `duplicate` in staging and are not auto-created.
- During final confirmation, race-condition duplicates are marked `skipped` with reason `already_exists_at_migration_time`.

## Migration Behavior
- Only selected rows with status `valid` are migrated.
- Migration uses existing `createPatient(...)` backend service path.
- Imported rows are created with `identifierType = national_id` as primary/default.
- Existing live patients are never updated in V1.

## Limitations (V1)
- Matching by national ID only.
- No fuzzy matching.
- No update or merge of existing patients.
- No alias engine / no passport-type import logic.
- No multi-file orchestration.
