alter table dicom_remap_jobs
  add column if not exists selected_study_instance_uid text,
  add column if not exists provisional_source_identity jsonb,
  add column if not exists processing_selection_counts jsonb;
