do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'patients_national_id_length_v1'
  ) then
    alter table patients
    add constraint patients_national_id_length_v1
    check (char_length(national_id) = 12) not valid;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'patients_phone_1_length_v1'
  ) then
    alter table patients
    add constraint patients_phone_1_length_v1
    check (char_length(phone_1) = 10) not valid;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'patients_phone_2_length_v1'
  ) then
    alter table patients
    add constraint patients_phone_2_length_v1
    check (phone_2 is null or char_length(phone_2) = 10) not valid;
  end if;
end $$;
