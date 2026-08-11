create table if not exists comparison_request_documents (
  comparison_request_id bigint not null references comparison_requests(id) on delete restrict,
  document_id bigint not null references documents(id) on delete cascade,
  created_by bigint references users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (comparison_request_id, document_id)
);

create index if not exists comparison_request_documents_document_idx
  on comparison_request_documents(document_id);

alter table dicom_remap_jobs
  add column if not exists comparison_request_id bigint references comparison_requests(id) on delete restrict;

create index if not exists dicom_remap_jobs_comparison_request_created_idx
  on dicom_remap_jobs(comparison_request_id, created_at desc)
  where comparison_request_id is not null;
