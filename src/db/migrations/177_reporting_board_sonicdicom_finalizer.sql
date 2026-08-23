alter table doctor_portal.reporting_board_sonicdicom_cache
  add column if not exists sonicdicom_latest_document_id text,
  add column if not exists sonicdicom_finalized_by_account text,
  add column if not exists finalized_by_doctor_id bigint,
  add column if not exists correlation_method text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reporting_board_sonicdicom_cache_finalized_by_doctor_fk'
  ) then
    alter table doctor_portal.reporting_board_sonicdicom_cache
      add constraint reporting_board_sonicdicom_cache_finalized_by_doctor_fk
      foreign key (finalized_by_doctor_id)
      references doctor_portal.doctor_profiles(id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'reporting_board_sonicdicom_cache_correlation_method_check'
  ) then
    alter table doctor_portal.reporting_board_sonicdicom_cache
      add constraint reporting_board_sonicdicom_cache_correlation_method_check
      check (correlation_method in ('study_instance_uid', 'accession_fallback'));
  end if;
end $$;

update doctor_portal.reporting_board_sonicdicom_cache
set next_check_at = now(),
    updated_at = now()
where report_status = 'final';
