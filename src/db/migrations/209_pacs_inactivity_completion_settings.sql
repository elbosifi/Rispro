alter table appointments_v2.pacs_auto_completion_settings
  add column if not exists inactivity_completion_minutes integer;

update appointments_v2.pacs_auto_completion_settings
set inactivity_completion_minutes = greatest(10, poll_interval_minutes + 1)
where inactivity_completion_minutes is null;

alter table appointments_v2.pacs_auto_completion_settings
  alter column inactivity_completion_minutes set default 10,
  alter column inactivity_completion_minutes set not null,
  alter column poll_interval_minutes set default 2;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pacs_auto_completion_inactivity_completion_minutes_check'
  ) then
    alter table appointments_v2.pacs_auto_completion_settings
      add constraint pacs_auto_completion_inactivity_completion_minutes_check
      check (inactivity_completion_minutes >= 2);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'pacs_auto_completion_poll_before_inactivity_check'
  ) then
    alter table appointments_v2.pacs_auto_completion_settings
      add constraint pacs_auto_completion_poll_before_inactivity_check
      check (poll_interval_minutes < inactivity_completion_minutes);
  end if;
end $$;
