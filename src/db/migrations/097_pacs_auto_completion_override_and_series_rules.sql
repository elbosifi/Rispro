alter table appointments_v2.bookings
  add column if not exists pacs_auto_completion_disabled_at timestamptz,
  add column if not exists pacs_auto_completion_disabled_by_user_id bigint references users(id) on delete set null,
  add column if not exists pacs_auto_completion_disabled_reason text;

alter table appointments_v2.pacs_auto_completion_settings
  add column if not exists minimum_series_count integer not null default 2,
  add column if not exists below_minimum_series_action text not null default 'leave_unchanged';

update appointments_v2.pacs_auto_completion_settings
set minimum_series_count = 2
where minimum_series_count is null or minimum_series_count < 1;

update appointments_v2.pacs_auto_completion_settings
set below_minimum_series_action = 'leave_unchanged'
where below_minimum_series_action is null
   or below_minimum_series_action not in ('leave_unchanged', 'discontinue');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pacs_auto_completion_minimum_series_count_check'
  ) then
    alter table appointments_v2.pacs_auto_completion_settings
      add constraint pacs_auto_completion_minimum_series_count_check
      check (minimum_series_count >= 1);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'pacs_auto_completion_below_minimum_series_action_check'
  ) then
    alter table appointments_v2.pacs_auto_completion_settings
      add constraint pacs_auto_completion_below_minimum_series_action_check
      check (below_minimum_series_action in ('leave_unchanged', 'discontinue'));
  end if;
end $$;

create index if not exists bookings_pacs_auto_completion_disabled_idx
  on appointments_v2.bookings (pacs_auto_completion_disabled_at)
  where pacs_auto_completion_disabled_at is not null;
