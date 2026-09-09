alter table protocol_versions
  add column if not exists protocol_notes text;

alter table protocol_ct_phases
  add column if not exists timing_type text,
  add column if not exists delay_seconds integer,
  add column if not exists bolus_tracking_site text,
  add column if not exists trigger_hu integer,
  add column if not exists post_trigger_delay_seconds integer;

alter table protocol_ct_phases
  drop constraint if exists protocol_ct_phases_timing_type_check,
  add constraint protocol_ct_phases_timing_type_check
    check (timing_type is null or timing_type in (
      'NON_CONTRAST',
      'FIXED_DELAY_INJECTION_START',
      'FIXED_DELAY_INJECTION_END',
      'BOLUS_TRACKING',
      'MANUAL'
    ));

create table if not exists protocol_ct_techniques (
  id bigserial primary key,
  protocol_version_id bigint not null references protocol_versions(id) on delete cascade,
  scanner_id bigint not null references equipment(id) on delete restrict,
  kv_mode text,
  kvp integer,
  tube_current_mode text,
  fixed_ma integer,
  reference_mas numeric,
  exposure_control text,
  noise_index numeric,
  min_ma integer,
  max_ma integer,
  reconstruction_method text,
  reconstruction_strength text,
  reconstruction_image_definition text,
  slice_thickness_mm numeric,
  reconstruction_interval_mm numeric,
  kernel text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (protocol_version_id, scanner_id),
  check (kv_mode is null or kv_mode in ('AUTO', 'FIXED')),
  check (tube_current_mode is null or tube_current_mode in ('AUTOMATIC', 'FIXED_MA', 'REFERENCE_MAS'))
);

drop trigger if exists trg_protocol_ct_techniques_updated_at on protocol_ct_techniques;
create trigger trg_protocol_ct_techniques_updated_at
before update on protocol_ct_techniques
for each row execute function touch_protocol_management_updated_at();
