-- Add identifier_type and identifier_value columns to patients table.
-- This supports foreign patients with passport or other identifiers.
-- Backward compatibility: existing national_id data is migrated.

-- Add new columns
alter table patients add column if not exists identifier_type text default 'national_id';
alter table patients add column if not exists identifier_value text;

-- Add check constraint for valid identifier types
alter table patients
  add constraint patients_identifier_type_check
  check (identifier_type in ('national_id', 'passport', 'other'));

-- Migrate existing national_id data to identifier_value
update patients
set identifier_value = national_id
where national_id is not null and identifier_value is null;

-- Add index for identifier lookup performance
create index if not exists idx_patients_identifier_type_value
  on patients (identifier_type, identifier_value)
  where identifier_value is not null;

-- Keep national_id column for backward compatibility (not dropping yet).
-- The application layer should use identifier_type/identifier_value going forward.
