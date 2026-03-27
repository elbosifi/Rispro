create sequence if not exists patient_mrn_seq start 1;

select setval(
  'patient_mrn_seq',
  greatest(
    (
      select coalesce(max((mrn)::bigint), 0)
      from patients
      where mrn ~ '^[0-9]+$'
    ),
    1
  ),
  exists (
    select 1
    from patients
    where mrn ~ '^[0-9]+$'
  )
);

alter table patients alter column mrn set default lpad(nextval('patient_mrn_seq')::text, 6, '0');

update system_settings
set setting_value = jsonb_set(setting_value, '{value}', '"optional"')
where category = 'patient_registration'
  and setting_key = 'national_id_required';
