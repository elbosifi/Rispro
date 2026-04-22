alter table patients
  add column if not exists category text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'patients_category_check'
  ) then
    alter table patients
      add constraint patients_category_check
      check (category in ('oncology', 'non_oncology'));
  end if;
end $$;
