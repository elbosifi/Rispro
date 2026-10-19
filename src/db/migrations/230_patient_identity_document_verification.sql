alter table documents
  add column if not exists identity_verified_at timestamptz;

alter table documents
  add column if not exists identity_verified_by_user_id bigint
  references users(id) on delete set null;

create index if not exists documents_patient_identity_latest_idx
  on documents (patient_id, created_at desc, id desc)
  where document_type = 'patient_identity_document';

create unique index if not exists documents_one_verified_identity_per_patient_idx
  on documents (patient_id)
  where document_type = 'patient_identity_document'
    and identity_verified_at is not null
    and patient_id is not null;
