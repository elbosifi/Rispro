-- ---------------------------------------------------------------------------
-- Appointments V2 schema
-- ---------------------------------------------------------------------------
-- This migration creates the full V2 schema for Appointments V2.
-- All tables are additive and do not modify any legacy scheduling tables.
-- Legacy scheduling code should not be changed by this migration.
-- ---------------------------------------------------------------------------

create schema if not exists appointments_v2;

-- ---------------------------------------------------------------------------
-- Policy set + versioning (authoritative configuration)
-- ---------------------------------------------------------------------------
create table if not exists appointments_v2.policy_sets (
  id bigserial primary key,
  key text not null unique,                  -- e.g. 'default'
  name text not null,
  created_at timestamptz not null default now(),
  created_by_user_id bigint references users(id)
);

create table if not exists appointments_v2.policy_versions (
  id bigserial primary key,
  policy_set_id bigint not null references appointments_v2.policy_sets(id) on delete cascade,
  version_no integer not null,
  status text not null check (status in ('draft', 'published', 'archived')),
  based_on_version_id bigint references appointments_v2.policy_versions(id),
  config_hash text not null,                 -- sha256 of canonical JSON snapshot
  change_note text,
  created_at timestamptz not null default now(),
  created_by_user_id bigint references users(id),
  published_at timestamptz,
  published_by_user_id bigint references users(id),
  unique (policy_set_id, version_no)
);

-- Only one published version per policy set
create unique index if not exists policy_versions_one_published_per_set
  on appointments_v2.policy_versions(policy_set_id)
  where status = 'published';

-- ---------------------------------------------------------------------------
-- Versioned rule tables (all rules belong to a policy_version)
-- ---------------------------------------------------------------------------
create table if not exists appointments_v2.category_daily_limits (
  id bigserial primary key,
  policy_version_id bigint not null references appointments_v2.policy_versions(id) on delete cascade,
  modality_id bigint not null references modalities(id) on delete cascade,
  case_category text not null check (case_category in ('oncology', 'non_oncology')),
  daily_limit integer not null check (daily_limit >= 0),
  is_active boolean not null default true,
  unique (policy_version_id, modality_id, case_category)
);

create table if not exists appointments_v2.modality_blocked_rules (
  id bigserial primary key,
  policy_version_id bigint not null references appointments_v2.policy_versions(id) on delete cascade,
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
  notes text
);

create index if not exists v2_modality_blocked_lookup
  on appointments_v2.modality_blocked_rules(policy_version_id, modality_id, is_active, rule_type, specific_date, start_date, end_date);

create table if not exists appointments_v2.exam_type_rules (
  id bigserial primary key,
  policy_version_id bigint not null references appointments_v2.policy_versions(id) on delete cascade,
  modality_id bigint not null references modalities(id) on delete cascade,
  rule_type text not null check (rule_type in ('specific_date', 'date_range', 'weekly_recurrence')),
  effect_mode text not null check (effect_mode in ('hard_restriction', 'restriction_overridable')),
  specific_date date,
  start_date date,
  end_date date,
  weekday smallint check (weekday between 0 and 6),
  alternate_weeks boolean not null default false,
  recurrence_anchor_date date,
  title text,
  notes text,
  is_active boolean not null default true
);

create index if not exists v2_exam_rules_lookup
  on appointments_v2.exam_type_rules(policy_version_id, modality_id, is_active, rule_type, specific_date, start_date, end_date, weekday);

create table if not exists appointments_v2.exam_type_rule_items (
  id bigserial primary key,
  rule_id bigint not null references appointments_v2.exam_type_rules(id) on delete cascade,
  exam_type_id bigint not null references exam_types(id) on delete cascade,
  unique (rule_id, exam_type_id)
);

create table if not exists appointments_v2.exam_type_special_quotas (
  id bigserial primary key,
  policy_version_id bigint not null references appointments_v2.policy_versions(id) on delete cascade,
  exam_type_id bigint not null references exam_types(id) on delete cascade,
  daily_extra_slots integer not null check (daily_extra_slots >= 0),
  is_active boolean not null default true,
  unique (policy_version_id, exam_type_id)
);

create table if not exists appointments_v2.special_reason_codes (
  code text primary key,
  label_ar text not null,
  label_en text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id bigint references users(id),
  updated_by_user_id bigint references users(id)
);

-- Seed default special reason codes
insert into appointments_v2.special_reason_codes (code, label_ar, label_en)
values
  ('urgent_oncology', 'حالة أورام عاجلة', 'Urgent oncology case'),
  ('medical_priority', 'أولوية طبية', 'Medical priority'),
  ('equipment_window', 'نافذة جهاز خاصة', 'Special equipment window')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Booking tables (V2 bookings; independent from legacy appointments)
-- ---------------------------------------------------------------------------
create table if not exists appointments_v2.bookings (
  id bigserial primary key,
  patient_id bigint not null references patients(id) on delete restrict,
  modality_id bigint not null references modalities(id) on delete restrict,
  exam_type_id bigint references exam_types(id) on delete restrict,
  reporting_priority_id bigint references reporting_priorities(id) on delete restrict,
  booking_date date not null,
  booking_time time,                                 -- null for day-level booking
  case_category text not null check (case_category in ('oncology', 'non_oncology')),
  status text not null check (status in ('scheduled', 'arrived', 'waiting', 'completed', 'no-show', 'cancelled')),
  notes text,
  policy_version_id bigint not null references appointments_v2.policy_versions(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by_user_id bigint references users(id),
  updated_at timestamptz not null default now(),
  updated_by_user_id bigint references users(id)
);

create index if not exists v2_bookings_bucket_idx
  on appointments_v2.bookings(modality_id, booking_date, case_category)
  where status <> 'cancelled';

-- ---------------------------------------------------------------------------
-- Override audit events (V2)
-- ---------------------------------------------------------------------------
create table if not exists appointments_v2.override_audit_events (
  id bigserial primary key,
  booking_id bigint references appointments_v2.bookings(id) on delete set null,
  patient_id bigint references patients(id) on delete set null,
  modality_id bigint references modalities(id) on delete set null,
  exam_type_id bigint references exam_types(id) on delete set null,
  booking_date date,
  requesting_user_id bigint references users(id),
  supervisor_user_id bigint references users(id),
  override_reason text,
  decision_snapshot jsonb not null default '{}'::jsonb,
  outcome text not null check (outcome in ('approved_and_booked', 'approved_but_failed', 'denied', 'cancelled')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Mutex rows for safe concurrency (row-level locking instead of advisory locks)
-- ---------------------------------------------------------------------------
create table if not exists appointments_v2.bucket_mutex (
  modality_id bigint not null references modalities(id) on delete cascade,
  booking_date date not null,
  case_category text not null check (case_category in ('oncology', 'non_oncology')),
  created_at timestamptz not null default now(),
  primary key (modality_id, booking_date, case_category)
);

-- ---------------------------------------------------------------------------
-- Seed: default policy set
-- ---------------------------------------------------------------------------
insert into appointments_v2.policy_sets (key, name)
values ('default', 'Default scheduling policy')
on conflict (key) do nothing;
