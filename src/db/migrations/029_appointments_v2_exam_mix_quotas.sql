-- ---------------------------------------------------------------------------
-- Appointments V2 — Exam mix quotas by exam-type groups
-- ---------------------------------------------------------------------------
-- Adds a new policy family to cap the daily mix of exam groups per modality.
-- These are caps (not extra slots) and remain separate from special quota.
-- ---------------------------------------------------------------------------

create table if not exists appointments_v2.exam_mix_quota_rules (
  id bigserial primary key,
  policy_version_id bigint not null references appointments_v2.policy_versions(id) on delete cascade,
  modality_id bigint not null references modalities(id) on delete cascade,
  title text,
  rule_type text not null check (rule_type in ('specific_date', 'date_range', 'weekly_recurrence')),
  specific_date date,
  start_date date,
  end_date date,
  weekday smallint check (weekday between 0 and 6),
  alternate_weeks boolean not null default false,
  recurrence_anchor_date date,
  daily_limit integer not null check (daily_limit > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists v2_exam_mix_rules_lookup
  on appointments_v2.exam_mix_quota_rules(
    policy_version_id,
    modality_id,
    is_active,
    rule_type,
    specific_date,
    start_date,
    end_date,
    weekday
  );

create table if not exists appointments_v2.exam_mix_quota_rule_items (
  id bigserial primary key,
  rule_id bigint not null references appointments_v2.exam_mix_quota_rules(id) on delete cascade,
  exam_type_id bigint not null references exam_types(id) on delete cascade,
  unique (rule_id, exam_type_id)
);

create index if not exists v2_exam_mix_rule_items_exam_type_idx
  on appointments_v2.exam_mix_quota_rule_items(exam_type_id, rule_id);
