create extension if not exists pgcrypto;

alter table doctor_portal.reporting_board_saved_views
  add column if not exists link_kind text not null default 'admin_saved_view',
  add column if not exists system_managed boolean not null default false,
  add column if not exists target_doctor_id bigint references doctor_portal.doctor_profiles(id) on delete restrict,
  add column if not exists admin_disabled_at timestamptz;

update doctor_portal.reporting_board_saved_views
set link_kind = 'admin_saved_view',
    system_managed = false,
    target_doctor_id = null
where link_kind is distinct from 'doctor_worklist';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'reporting_board_saved_views_link_kind_check'
  ) then
    alter table doctor_portal.reporting_board_saved_views
      add constraint reporting_board_saved_views_link_kind_check
      check (link_kind in ('admin_saved_view', 'doctor_worklist'));
  end if;
end $$;

create unique index if not exists reporting_board_saved_views_one_doctor_worklist_idx
  on doctor_portal.reporting_board_saved_views(target_doctor_id)
  where link_kind = 'doctor_worklist' and system_managed = true;

create index if not exists reporting_board_saved_views_kind_active_idx
  on doctor_portal.reporting_board_saved_views(link_kind, active, target_doctor_id);

insert into doctor_portal.reporting_board_saved_views (
  owner_user_id,
  owner_doctor_id,
  name,
  token,
  filters_json,
  notification_settings_json,
  active,
  link_kind,
  system_managed,
  target_doctor_id
)
select
  null,
  null,
  dp.display_name || ' Worklist',
  encode(gen_random_bytes(32), 'hex'),
  '{}'::jsonb,
  '{}'::jsonb,
  dp.active and u.is_active,
  'doctor_worklist',
  true,
  dp.id
from doctor_portal.doctor_profiles dp
join users u on u.id = dp.user_id
on conflict (target_doctor_id)
  where link_kind = 'doctor_worklist' and system_managed = true
do nothing;

update system_settings
set setting_value = jsonb_set(setting_value, '{value,daysBack}', '30'::jsonb, true),
    updated_at = now()
where category = 'doctor_portal_reporting_board'
  and setting_key = 'config'
  and coalesce((setting_value #>> '{value,daysBack}')::integer, 14) = 14;

comment on column doctor_portal.reporting_board_saved_views.target_doctor_id is
  'Fixed doctor identity for a system-managed personal worklist. Current reporting assignments remain single-primary; team assignment is a future extension.';
