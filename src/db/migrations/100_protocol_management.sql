create table if not exists protocol_anatomy_regions (
  id bigserial primary key,
  name text not null,
  body_system text,
  modality_scope text not null check (modality_scope in ('CT', 'MRI', 'BOTH')),
  default_coverage_note text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists imaging_scanners (
  id bigserial primary key,
  name text not null,
  modality text not null check (modality in ('CT', 'MRI')),
  vendor text,
  model text,
  field_strength text,
  location text,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ct_phase_presets (
  id bigserial primary key,
  name text not null,
  contrast_status text not null check (contrast_status in ('NON_CONTRAST', 'POST_CONTRAST', 'DELAYED', 'OTHER')),
  timing_type text not null check (timing_type in ('NONE', 'FIXED_DELAY', 'BOLUS_TRACKING', 'MANUAL')),
  delay_seconds integer,
  bolus_tracking_site text,
  trigger_hu integer,
  default_coverage text,
  reconstruction_notes text,
  instructions text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists mri_sequence_presets (
  id bigserial primary key,
  scanner_id bigint references imaging_scanners(id) on delete set null,
  vendor text,
  name text not null,
  vendor_sequence_name text,
  generic_family text,
  weighting text,
  default_plane text,
  contrast_relation text,
  default_coverage text,
  default_b_values text,
  default_dynamic_timing text,
  estimated_scan_time_minutes integer,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists protocols (
  id bigserial primary key,
  name text not null,
  modality text not null check (modality in ('CT', 'MRI')),
  anatomy_region_id bigint references protocol_anatomy_regions(id) on delete set null,
  category text,
  indication text,
  contrast_policy text,
  active_version_id bigint,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists protocol_versions (
  id bigserial primary key,
  protocol_id bigint not null references protocols(id) on delete cascade,
  version_number text not null,
  status text not null check (status in ('DRAFT', 'ACTIVE', 'RETIRED')),
  change_summary text,
  created_by bigint references users(id) on delete set null,
  approved_by bigint references users(id) on delete set null,
  approved_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table protocols
  drop constraint if exists protocols_active_version_id_fkey,
  add constraint protocols_active_version_id_fkey
    foreign key (active_version_id) references protocol_versions(id) on delete set null;

create table if not exists protocol_ct_phases (
  id bigserial primary key,
  protocol_version_id bigint not null references protocol_versions(id) on delete cascade,
  order_index integer not null,
  ct_phase_preset_id bigint references ct_phase_presets(id) on delete set null,
  custom_phase_name text,
  timing_override text,
  coverage_override text,
  reconstruction_override text,
  instructions_override text,
  is_required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists protocol_mri_sequences (
  id bigserial primary key,
  protocol_version_id bigint not null references protocol_versions(id) on delete cascade,
  scanner_id bigint references imaging_scanners(id) on delete set null,
  order_index integer not null,
  mri_sequence_preset_id bigint references mri_sequence_presets(id) on delete set null,
  plane_override text,
  coverage_override text,
  b_values_override text,
  timing_override text,
  notes_override text,
  is_required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists appointment_protocol_assignments (
  id bigserial primary key,
  appointment_id bigint not null references appointments_v2.bookings(id) on delete cascade,
  protocol_id bigint not null references protocols(id) on delete restrict,
  protocol_version_id bigint not null references protocol_versions(id) on delete restrict,
  scanner_id bigint references imaging_scanners(id) on delete set null,
  assigned_by bigint references users(id) on delete set null,
  assigned_at timestamptz default now(),
  protocol_notes text,
  contrast_notes text,
  status text not null default 'ASSIGNED' check (status in ('ASSIGNED', 'MODIFIED', 'CANCELLED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists protocols_modality_idx on protocols(modality);
create index if not exists protocols_anatomy_region_id_idx on protocols(anatomy_region_id);
create index if not exists protocol_versions_protocol_id_idx on protocol_versions(protocol_id);
create index if not exists protocol_versions_status_idx on protocol_versions(status);
create index if not exists appointment_protocol_assignments_appointment_idx on appointment_protocol_assignments(appointment_id);
create index if not exists appointment_protocol_assignments_protocol_version_idx on appointment_protocol_assignments(protocol_version_id);
create index if not exists mri_sequence_presets_scanner_id_idx on mri_sequence_presets(scanner_id);

create or replace function touch_protocol_management_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_protocol_anatomy_regions_updated_at on protocol_anatomy_regions;
create trigger trg_protocol_anatomy_regions_updated_at
before update on protocol_anatomy_regions
for each row execute function touch_protocol_management_updated_at();

drop trigger if exists trg_imaging_scanners_updated_at on imaging_scanners;
create trigger trg_imaging_scanners_updated_at
before update on imaging_scanners
for each row execute function touch_protocol_management_updated_at();

drop trigger if exists trg_ct_phase_presets_updated_at on ct_phase_presets;
create trigger trg_ct_phase_presets_updated_at
before update on ct_phase_presets
for each row execute function touch_protocol_management_updated_at();

drop trigger if exists trg_mri_sequence_presets_updated_at on mri_sequence_presets;
create trigger trg_mri_sequence_presets_updated_at
before update on mri_sequence_presets
for each row execute function touch_protocol_management_updated_at();

drop trigger if exists trg_protocols_updated_at on protocols;
create trigger trg_protocols_updated_at
before update on protocols
for each row execute function touch_protocol_management_updated_at();

drop trigger if exists trg_protocol_versions_updated_at on protocol_versions;
create trigger trg_protocol_versions_updated_at
before update on protocol_versions
for each row execute function touch_protocol_management_updated_at();

drop trigger if exists trg_protocol_ct_phases_updated_at on protocol_ct_phases;
create trigger trg_protocol_ct_phases_updated_at
before update on protocol_ct_phases
for each row execute function touch_protocol_management_updated_at();

drop trigger if exists trg_protocol_mri_sequences_updated_at on protocol_mri_sequences;
create trigger trg_protocol_mri_sequences_updated_at
before update on protocol_mri_sequences
for each row execute function touch_protocol_management_updated_at();

drop trigger if exists trg_appointment_protocol_assignments_updated_at on appointment_protocol_assignments;
create trigger trg_appointment_protocol_assignments_updated_at
before update on appointment_protocol_assignments
for each row execute function touch_protocol_management_updated_at();
