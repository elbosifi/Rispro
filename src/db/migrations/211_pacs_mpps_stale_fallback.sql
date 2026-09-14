alter table appointments_v2.pacs_auto_completion_settings
  add column if not exists mpps_stale_fallback_minutes integer;

update appointments_v2.pacs_auto_completion_settings
set mpps_stale_fallback_minutes = greatest(
  180,
  coalesce(inactivity_completion_minutes, 10) + 1
)
where mpps_stale_fallback_minutes is null;

alter table appointments_v2.pacs_auto_completion_settings
  alter column mpps_stale_fallback_minutes set default 180,
  alter column mpps_stale_fallback_minutes set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pacs_auto_completion_mpps_stale_fallback_minutes_check'
  ) then
    alter table appointments_v2.pacs_auto_completion_settings
      add constraint pacs_auto_completion_mpps_stale_fallback_minutes_check
      check (mpps_stale_fallback_minutes >= 30);
  end if;
end $$;
