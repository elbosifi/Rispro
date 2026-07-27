alter table request_scan_jobs
  add column if not exists workflow_source text not null default 'reception',
  add column if not exists modality_id bigint references modalities(id) on delete restrict;

alter table request_scan_jobs drop constraint if exists request_scan_jobs_workflow_source_check;
alter table request_scan_jobs add constraint request_scan_jobs_workflow_source_check
  check (workflow_source in ('reception', 'modality'));

alter table request_scan_jobs drop constraint if exists request_scan_jobs_modality_context_check;
alter table request_scan_jobs add constraint request_scan_jobs_modality_context_check
  check (
    (workflow_source = 'reception' and modality_id is null)
    or (workflow_source = 'modality' and modality_id is not null)
  );

create index if not exists idx_request_scan_jobs_workflow_modality_status
  on request_scan_jobs(workflow_source, modality_id, status, created_at desc);

alter table request_scan_jobs drop constraint if exists request_scan_jobs_failure_category_check;
alter table request_scan_jobs add constraint request_scan_jobs_failure_category_check
  check (failure_category is null or failure_category in ('recognition','identifier_conflict','modality_mismatch','smb_storage','source_missing','processing_interrupted','duplicate_or_existing','internal_processing','unknown'));

alter table documents drop constraint if exists documents_source_check;
alter table documents add constraint documents_source_check
  check (source in ('manual_upload', 'naps2_webscan', 'scanner_app', 'request_scan_automation', 'modality_scan_automation'));

insert into system_settings(category, setting_key, setting_value)
values ('request_scan_automation', 'modality_documents_root_subfolder', '{"value":"ModalityDocuments"}'::jsonb)
on conflict (category, setting_key) do nothing;
