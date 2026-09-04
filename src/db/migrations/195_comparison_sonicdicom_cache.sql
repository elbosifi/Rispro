create table if not exists doctor_portal.comparison_sonicdicom_cache (
  comparison_assignment_id bigint primary key
    references doctor_portal.comparison_case_assignments(id) on delete cascade,
  comparison_request_id bigint not null
    references comparison_requests(id) on delete cascade,
  report_status text not null
    check (report_status in ('final', 'draft', 'no_report', 'study_not_found', 'unavailable')),
  sonicdicom_report_no integer,
  sonicdicom_document_id text,
  sonicdicom_account text,
  report_final_at timestamptz,
  correlation_method text
    check (correlation_method is null or correlation_method in ('study_instance_uid', 'accession_fallback')),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  next_check_at timestamptz not null default now(),
  status_changed_at timestamptz,
  failure_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists comparison_sonicdicom_cache_request_idx
  on doctor_portal.comparison_sonicdicom_cache(comparison_request_id);
create index if not exists comparison_sonicdicom_cache_due_idx
  on doctor_portal.comparison_sonicdicom_cache(next_check_at, comparison_assignment_id);
create index if not exists comparison_sonicdicom_cache_document_idx
  on doctor_portal.comparison_sonicdicom_cache(sonicdicom_document_id)
  where sonicdicom_document_id is not null;

comment on table doctor_portal.comparison_sonicdicom_cache is
  'This table is a durable external SonicDICOM observation/correlation per comparison assignment. It does not replace comparison_requests workflow state/finalized_at/final_text.';
