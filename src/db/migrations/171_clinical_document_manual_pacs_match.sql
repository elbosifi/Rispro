alter table clinical_document_exports
  add column if not exists manual_study_match boolean not null default false;
