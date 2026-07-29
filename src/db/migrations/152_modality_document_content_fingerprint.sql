alter table documents
  add column if not exists content_sha256 char(64);

alter table documents
  drop constraint if exists documents_content_sha256_format_check;

alter table documents
  add constraint documents_content_sha256_format_check
  check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$');

create index if not exists documents_modality_clinical_fingerprint_idx
  on documents(patient_id, file_size, content_sha256)
  where document_type = 'clinical_document'
    and source = 'modality_scan_automation'
    and content_sha256 is not null;

create index if not exists documents_modality_clinical_legacy_fingerprint_idx
  on documents(patient_id, file_size)
  where document_type = 'clinical_document'
    and source = 'modality_scan_automation'
    and content_sha256 is null;
