-- External status only: the authoritative PACS catalogue remains unchanged.
create table doctor_portal.workspace_sonicdicom_cache (
  archive_key text not null,
  sonic_source_key text not null,
  study_instance_uid text not null,
  orthanc_study_id text not null,
  patient_id text not null,
  metadata_key text not null,
  report_status text check(report_status in ('final','draft','no_report','study_not_found')),
  report_final_at timestamptz,
  document_id text,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  failure_count integer not null default 0,
  next_check_at timestamptz not null default now(),
  primary key(archive_key,sonic_source_key,study_instance_uid)
);
create index workspace_sonicdicom_due_idx on doctor_portal.workspace_sonicdicom_cache(archive_key,sonic_source_key,next_check_at);

-- Invalid/partial DICOM dates sort last without rewriting cached or signed data.
create function workspace_study_date(value text) returns date language plpgsql immutable strict parallel safe as $$
declare clean text;
begin
  if value !~ '^(\d{8}|\d{4}-\d{2}-\d{2})$' then return null; end if;
  clean=replace(value,'-','');
  return make_date(substr(clean,1,4)::int,substr(clean,5,2)::int,substr(clean,7,2)::int);
exception when datetime_field_overflow then return null;
end $$;
create index historical_pacs_workspace_valid_date_idx on historical_pacs_studies(workspace_study_date(study_date) desc nulls last,orthanc_study_id);
