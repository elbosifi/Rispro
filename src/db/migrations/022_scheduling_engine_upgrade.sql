-- Phase 1: additive schema for scheduling engine and patient multi-identifiers.
-- Backward compatible: existing flows keep working when new data is absent.

-- ---------------------------------------------------------------------------
-- Feature flags
-- ---------------------------------------------------------------------------
insert into system_settings (category, setting_key, setting_value)
values
  ('scheduling_and_capacity', 'scheduling_engine_enabled', '{"value":"disabled"}'::jsonb),
  ('scheduling_and_capacity', 'scheduling_engine_shadow_mode', '{"value":"enabled"}'::jsonb)
on conflict (category, setting_key) do nothing;

-- ---------------------------------------------------------------------------
-- Patient identifiers
-- ---------------------------------------------------------------------------
create table if not exists patient_identifier_types (
  id bigserial primary key,
  code text not null unique,
  label_ar text not null,
  label_en text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id bigint references users(id),
  updated_by_user_id bigint references users(id)
);

insert into patient_identifier_types (code, label_ar, label_en)
values
  ('national_id', 'الرقم الوطني', 'National ID'),
  ('passport', 'جواز السفر', 'Passport'),
  ('other', 'معرّف آخر', 'Other')
on conflict (code) do nothing;

create table if not exists patient_identifiers (
  id bigserial primary key,
  patient_id bigint not null references patients(id) on delete cascade,
  identifier_type_id bigint not null references patient_identifier_types(id) on delete restrict,
  value text not null,
  normalized_value text not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id bigint references users(id),
  updated_by_user_id bigint references users(id)
);

create unique index if not exists patient_identifiers_unique_type_normalized
  on patient_identifiers (identifier_type_id, normalized_value);

create unique index if not exists patient_identifiers_one_primary_per_patient
  on patient_identifiers (patient_id)
  where is_primary = true;

create index if not exists patient_identifiers_patient_idx
  on patient_identifiers (patient_id, identifier_type_id);

-- ---------------------------------------------------------------------------
-- Appointment additive fields
-- ---------------------------------------------------------------------------
alter table appointments
  add column if not exists case_category text not null default 'non_oncology',
  add column if not exists uses_special_quota boolean not null default false,
  add column if not exists special_reason_code text,
  add column if not exists special_reason_note text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'appointments_case_category_check'
  ) then
    alter table appointments
    add constraint appointments_case_category_check
    check (case_category in ('oncology', 'non_oncology'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Scheduling rule and capacity tables
-- ---------------------------------------------------------------------------
create table if not exists modality_category_daily_limits (
  id bigserial primary key,
  modality_id bigint not null references modalities(id) on delete cascade,
  case_category text not null check (case_category in ('oncology', 'non_oncology')),
  daily_limit integer not null check (daily_limit >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id bigint references users(id),
  updated_by_user_id bigint references users(id),
  unique (modality_id, case_category)
);

create table if not exists modality_blocked_rules (
  id bigserial primary key,
  modality_id bigint not null references modalities(id) on delete cascade,
  rule_type text not null check (rule_type in ('specific_date', 'date_range', 'yearly_recurrence')),
  specific_date date,
  start_date date,
  end_date date,
  recur_start_month smallint,
  recur_start_day smallint,
  recur_end_month smallint,
  recur_end_day smallint,
  is_overridable boolean not null default false,
  is_active boolean not null default true,
  title text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id bigint references users(id),
  updated_by_user_id bigint references users(id)
);

create index if not exists modality_blocked_rules_lookup_idx
  on modality_blocked_rules (modality_id, is_active, rule_type, specific_date, start_date, end_date);

create table if not exists exam_type_schedule_rules (
  id bigserial primary key,
  modality_id bigint not null references modalities(id) on delete cascade,
  rule_type text not null check (rule_type in ('specific_date', 'date_range', 'weekly_recurrence')),
  effect_mode text not null default 'restriction_overridable'
    check (effect_mode in ('hard_restriction', 'restriction_overridable')),
  specific_date date,
  start_date date,
  end_date date,
  weekday smallint check (weekday between 0 and 6),
  alternate_weeks boolean not null default false,
  recurrence_anchor_date date,
  title text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id bigint references users(id),
  updated_by_user_id bigint references users(id)
);

create index if not exists exam_type_schedule_rules_lookup_idx
  on exam_type_schedule_rules (modality_id, is_active, rule_type, specific_date, start_date, end_date, weekday);

create table if not exists exam_type_schedule_rule_items (
  id bigserial primary key,
  rule_id bigint not null references exam_type_schedule_rules(id) on delete cascade,
  exam_type_id bigint not null references exam_types(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (rule_id, exam_type_id)
);

create table if not exists special_reason_codes (
  code text primary key,
  label_ar text not null,
  label_en text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id bigint references users(id),
  updated_by_user_id bigint references users(id)
);

insert into special_reason_codes (code, label_ar, label_en)
values
  ('urgent_oncology', 'حالة أورام عاجلة', 'Urgent oncology case'),
  ('medical_priority', 'أولوية طبية', 'Medical priority'),
  ('equipment_window', 'نافذة جهاز خاصة', 'Special equipment window')
on conflict (code) do nothing;

create table if not exists exam_type_special_quotas (
  id bigserial primary key,
  exam_type_id bigint not null references exam_types(id) on delete cascade,
  daily_extra_slots integer not null check (daily_extra_slots >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id bigint references users(id),
  updated_by_user_id bigint references users(id),
  unique (exam_type_id)
);

create table if not exists appointment_quota_consumptions (
  id bigserial primary key,
  appointment_id bigint not null references appointments(id) on delete cascade,
  appointment_date date not null,
  modality_id bigint not null references modalities(id) on delete cascade,
  exam_type_id bigint references exam_types(id) on delete set null,
  case_category text check (case_category in ('oncology', 'non_oncology')),
  consumption_mode text not null check (consumption_mode in ('special', 'override')),
  consumed_slots integer not null default 1 check (consumed_slots > 0),
  released_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id bigint references users(id),
  updated_by_user_id bigint references users(id),
  unique (appointment_id, consumption_mode)
);

create index if not exists appointment_quota_consumptions_bucket_idx
  on appointment_quota_consumptions (appointment_date, modality_id, exam_type_id, case_category)
  where released_at is null;

create table if not exists scheduling_override_audit_events (
  id bigserial primary key,
  appointment_id bigint references appointments(id) on delete set null,
  patient_id bigint references patients(id) on delete set null,
  modality_id bigint references modalities(id) on delete set null,
  exam_type_id bigint references exam_types(id) on delete set null,
  appointment_date date,
  requesting_user_id bigint references users(id),
  supervisor_user_id bigint references users(id),
  override_reason text,
  evaluation_snapshot jsonb not null default '{}'::jsonb,
  outcome text not null check (outcome in ('approved_and_booked', 'approved_but_failed', 'denied', 'cancelled')),
  created_at timestamptz not null default now()
);
