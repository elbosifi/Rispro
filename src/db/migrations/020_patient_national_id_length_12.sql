do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'patients_national_id_length_v1'
  ) then
    alter table patients drop constraint patients_national_id_length_v1;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'patients_national_id_length_v2'
  ) then
    alter table patients
    add constraint patients_national_id_length_v2
    check (char_length(national_id) = 12) not valid;
  end if;
end $$;
