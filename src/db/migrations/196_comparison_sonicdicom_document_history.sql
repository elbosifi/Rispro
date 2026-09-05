create table if not exists doctor_portal.comparison_sonicdicom_documents (
  comparison_assignment_id bigint not null
    references doctor_portal.comparison_case_assignments(id) on delete cascade,
  sonicdicom_document_id text not null,
  sonicdicom_report_no integer,
  sonicdicom_account text,
  last_status_code integer,
  document_updated_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  removed_at timestamptz,
  primary key (comparison_assignment_id, sonicdicom_document_id)
);

create index if not exists comparison_sonicdicom_documents_document_idx
  on doctor_portal.comparison_sonicdicom_documents(sonicdicom_document_id);

comment on table doctor_portal.comparison_sonicdicom_documents is
  'Metadata and correlation history for SonicDICOM comparison documents; it contains no clinical report text.';

alter table doctor_portal.comparison_sonicdicom_cache
  add column if not exists sonicdicom_status_code integer,
  add column if not exists sonicdicom_document_updated_at timestamptz;

insert into doctor_portal.comparison_sonicdicom_documents (
  comparison_assignment_id, sonicdicom_document_id, sonicdicom_report_no, sonicdicom_account, last_seen_at
)
select comparison_assignment_id, sonicdicom_document_id, sonicdicom_report_no, sonicdicom_account, now()
from doctor_portal.comparison_sonicdicom_cache
where nullif(btrim(sonicdicom_document_id), '') is not null
on conflict (comparison_assignment_id, sonicdicom_document_id) do update set
  sonicdicom_report_no = coalesce(excluded.sonicdicom_report_no, doctor_portal.comparison_sonicdicom_documents.sonicdicom_report_no),
  sonicdicom_account = coalesce(excluded.sonicdicom_account, doctor_portal.comparison_sonicdicom_documents.sonicdicom_account),
  last_seen_at = greatest(doctor_portal.comparison_sonicdicom_documents.last_seen_at, excluded.last_seen_at);
