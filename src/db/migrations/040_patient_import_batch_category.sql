alter table patient_import_batches
  add column if not exists patient_category text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'patient_import_batches_patient_category_check'
  ) then
    alter table patient_import_batches
      add constraint patient_import_batches_patient_category_check
      check (patient_category in ('oncology', 'non_oncology'));
  end if;
end $$;
