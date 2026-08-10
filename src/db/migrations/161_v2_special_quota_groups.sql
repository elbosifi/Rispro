-- Appointments V2 - generalized Special Quota groups and durable consumption.
--
-- Cutover strategy:
-- 1. Add the generalized rule, membership, mutex, and consumption tables.
-- 2. Backfill one generalized rule for every legacy one-exam quota. Rows are
--    deliberately not merged, even when their users/capacity are identical.
-- 3. Backfill durable consumption from bookings.uses_special_quota.
-- 4. Assert row/membership/consumption counts before the migration commits.
--
-- The legacy exam_type_special_quotas tables are retained for rollback/data
-- verification only. Application code after this migration must not read or
-- write them.

do $$
begin
  if exists (
    select 1
    from appointments_v2.exam_type_special_quotas legacy_quota
    join exam_types exam_type on exam_type.id = legacy_quota.exam_type_id
    where exam_type.modality_id is null
  ) then
    raise exception 'Cannot migrate Special Quota with an exam type that has no modality';
  end if;
end $$;

create table if not exists appointments_v2.special_quota_rules (
  id bigserial primary key,
  logical_key uuid not null,
  policy_version_id bigint not null references appointments_v2.policy_versions(id) on delete cascade,
  modality_id bigint not null references modalities(id) on delete restrict,
  title text,
  daily_extra_slots integer not null check (daily_extra_slots >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (policy_version_id, logical_key)
);

create index if not exists v2_special_quota_rules_policy_modality_lookup
  on appointments_v2.special_quota_rules(policy_version_id, modality_id, is_active);

create table if not exists appointments_v2.special_quota_rule_exam_types (
  quota_rule_id bigint not null references appointments_v2.special_quota_rules(id) on delete cascade,
  exam_type_id bigint not null references exam_types(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (quota_rule_id, exam_type_id)
);

create index if not exists v2_special_quota_exam_types_exam_lookup
  on appointments_v2.special_quota_rule_exam_types(exam_type_id, quota_rule_id);

create table if not exists appointments_v2.special_quota_rule_users (
  quota_rule_id bigint not null references appointments_v2.special_quota_rules(id) on delete cascade,
  user_id bigint not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (quota_rule_id, user_id)
);

create index if not exists v2_special_quota_rule_users_user_lookup
  on appointments_v2.special_quota_rule_users(user_id, quota_rule_id);

create table if not exists appointments_v2.special_quota_bucket_mutex (
  quota_logical_key uuid not null,
  booking_date date not null,
  created_at timestamptz not null default now(),
  primary key (quota_logical_key, booking_date)
);

create table if not exists appointments_v2.special_quota_consumptions (
  id bigserial primary key,
  booking_id bigint not null references appointments_v2.bookings(id) on delete restrict,
  quota_rule_id bigint not null references appointments_v2.special_quota_rules(id) on delete restrict,
  quota_logical_key uuid not null,
  policy_version_id bigint not null references appointments_v2.policy_versions(id) on delete restrict,
  booking_date date not null,
  exam_type_id bigint not null references exam_types(id) on delete restrict,
  consumed_by_user_id bigint references users(id) on delete restrict,
  consumed_at timestamptz not null default now(),
  released_at timestamptz,
  released_by_user_id bigint references users(id) on delete restrict,
  release_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (released_at is not null or (released_by_user_id is null and release_reason is null))
);

create unique index if not exists v2_special_quota_one_active_consumption_per_booking
  on appointments_v2.special_quota_consumptions(booking_id)
  where released_at is null;

create index if not exists v2_special_quota_active_pool_date_lookup
  on appointments_v2.special_quota_consumptions(quota_logical_key, booking_date)
  where released_at is null;

insert into appointments_v2.special_quota_rules (
  logical_key,
  policy_version_id,
  modality_id,
  title,
  daily_extra_slots,
  is_active,
  created_at,
  updated_at
)
select
  md5(concat('rispro-special-quota:', policy_version.policy_set_id, ':exam:', legacy_quota.exam_type_id))::uuid,
  legacy_quota.policy_version_id,
  exam_type.modality_id,
  null,
  legacy_quota.daily_extra_slots,
  legacy_quota.is_active,
  policy_version.created_at,
  policy_version.created_at
from appointments_v2.exam_type_special_quotas legacy_quota
join appointments_v2.policy_versions policy_version on policy_version.id = legacy_quota.policy_version_id
join exam_types exam_type on exam_type.id = legacy_quota.exam_type_id
on conflict (policy_version_id, logical_key) do nothing;

insert into appointments_v2.special_quota_rule_exam_types (quota_rule_id, exam_type_id)
select new_quota.id, legacy_quota.exam_type_id
from appointments_v2.exam_type_special_quotas legacy_quota
join appointments_v2.policy_versions policy_version on policy_version.id = legacy_quota.policy_version_id
join appointments_v2.special_quota_rules new_quota
  on new_quota.policy_version_id = legacy_quota.policy_version_id
 and new_quota.logical_key = md5(concat('rispro-special-quota:', policy_version.policy_set_id, ':exam:', legacy_quota.exam_type_id))::uuid
on conflict do nothing;

insert into appointments_v2.special_quota_rule_users (quota_rule_id, user_id)
select new_quota.id, legacy_user.user_id
from appointments_v2.exam_type_special_quota_users legacy_user
join appointments_v2.exam_type_special_quotas legacy_quota on legacy_quota.id = legacy_user.quota_id
join appointments_v2.policy_versions policy_version on policy_version.id = legacy_quota.policy_version_id
join appointments_v2.special_quota_rules new_quota
  on new_quota.policy_version_id = legacy_quota.policy_version_id
 and new_quota.logical_key = md5(concat('rispro-special-quota:', policy_version.policy_set_id, ':exam:', legacy_quota.exam_type_id))::uuid
on conflict do nothing;

do $$
declare
  legacy_rule_count bigint;
  migrated_rule_count bigint;
  legacy_user_count bigint;
  migrated_user_count bigint;
begin
  select count(*) into legacy_rule_count
  from appointments_v2.exam_type_special_quotas;

  select count(*) into migrated_rule_count
  from appointments_v2.special_quota_rules;

  if migrated_rule_count <> legacy_rule_count then
    raise exception 'Special Quota rule backfill mismatch: legacy %, migrated %', legacy_rule_count, migrated_rule_count;
  end if;

  if (select count(*) from appointments_v2.special_quota_rule_exam_types) <> legacy_rule_count then
    raise exception 'Special Quota exam membership backfill mismatch';
  end if;

  select count(*) into legacy_user_count
  from appointments_v2.exam_type_special_quota_users;

  select count(*) into migrated_user_count
  from appointments_v2.special_quota_rule_users;

  if migrated_user_count <> legacy_user_count then
    raise exception 'Special Quota user membership backfill mismatch: legacy %, migrated %', legacy_user_count, migrated_user_count;
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from appointments_v2.bookings booking
    where booking.uses_special_quota = true
      and not exists (
        select 1
        from appointments_v2.special_quota_rules quota_rule
        join appointments_v2.special_quota_rule_exam_types membership
          on membership.quota_rule_id = quota_rule.id
        where quota_rule.policy_version_id = booking.policy_version_id
          and membership.exam_type_id = booking.exam_type_id
      )
  ) then
    raise exception 'Cannot backfill a special-quota booking without a matching historical quota rule';
  end if;
end $$;

insert into appointments_v2.special_quota_consumptions (
  booking_id,
  quota_rule_id,
  quota_logical_key,
  policy_version_id,
  booking_date,
  exam_type_id,
  consumed_by_user_id,
  consumed_at,
  released_at,
  release_reason,
  created_at,
  updated_at
)
select
  booking.id,
  quota_rule.id,
  quota_rule.logical_key,
  booking.policy_version_id,
  booking.booking_date,
  booking.exam_type_id,
  booking.created_by_user_id,
  booking.created_at,
  case when booking.status in ('cancelled', 'discontinued', 'voided') then booking.updated_at else null end,
  case when booking.status in ('cancelled', 'discontinued', 'voided') then concat('legacy_backfill_', booking.status) else null end,
  booking.created_at,
  booking.updated_at
from appointments_v2.bookings booking
join appointments_v2.special_quota_rules quota_rule
  on quota_rule.policy_version_id = booking.policy_version_id
join appointments_v2.special_quota_rule_exam_types membership
  on membership.quota_rule_id = quota_rule.id
 and membership.exam_type_id = booking.exam_type_id
where booking.uses_special_quota = true
  and not exists (
    select 1
    from appointments_v2.special_quota_consumptions existing
    where existing.booking_id = booking.id
  );

do $$
begin
  if (select count(*) from appointments_v2.special_quota_consumptions)
     <> (select count(*) from appointments_v2.bookings where uses_special_quota = true) then
    raise exception 'Special Quota booking consumption backfill mismatch';
  end if;
end $$;
