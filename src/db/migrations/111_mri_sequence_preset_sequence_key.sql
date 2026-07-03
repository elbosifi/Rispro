alter table mri_sequence_presets
  add column if not exists sequence_key text;

create unique index if not exists mri_sequence_presets_sequence_key_lower_uidx
  on mri_sequence_presets (lower(sequence_key))
  where sequence_key is not null;
