alter table mri_sequence_presets
  add column if not exists fat_suppression text,
  add column if not exists acquisition_type text;

create table if not exists mri_sequence_scanner_aliases (
  id bigserial primary key,
  mri_sequence_preset_id bigint not null references mri_sequence_presets(id) on delete cascade,
  scanner_id bigint not null references imaging_scanners(id) on delete cascade,
  vendor_sequence_name text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mri_sequence_preset_id, scanner_id)
);

create index if not exists mri_sequence_scanner_aliases_preset_idx
  on mri_sequence_scanner_aliases(mri_sequence_preset_id);

drop trigger if exists trg_mri_sequence_scanner_aliases_updated_at on mri_sequence_scanner_aliases;
create trigger trg_mri_sequence_scanner_aliases_updated_at
before update on mri_sequence_scanner_aliases
for each row execute function touch_protocol_management_updated_at();
