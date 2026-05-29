create table if not exists doctor_portal.reporting_board_saved_views (
  id bigserial primary key,
  owner_user_id bigint references users(id),
  owner_doctor_id bigint references doctor_portal.doctor_profiles(id),
  name text not null,
  token text not null unique,
  filters_json jsonb not null default '{}'::jsonb,
  notification_settings_json jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_by_user_id bigint references users(id),
  updated_by_user_id bigint references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reporting_board_saved_views_token_idx
  on doctor_portal.reporting_board_saved_views(token);

create index if not exists reporting_board_saved_views_owner_user_active_idx
  on doctor_portal.reporting_board_saved_views(owner_user_id, active);

create index if not exists reporting_board_saved_views_owner_doctor_active_idx
  on doctor_portal.reporting_board_saved_views(owner_doctor_id, active);

create index if not exists reporting_board_saved_views_created_at_idx
  on doctor_portal.reporting_board_saved_views(created_at desc);

insert into system_settings (category, setting_key, setting_value)
values (
  'doctor_portal_reporting_board',
  'config',
  '{
    "value": {
      "cutoffMode": "days_back",
      "defaultCutoffDate": null,
      "daysBack": 14,
      "enabledModalityCodes": ["CT", "MR"],
      "defaultRequiresReport": true,
      "defaultReportStatusFilter": "required_not_final"
    }
  }'::jsonb
)
on conflict (category, setting_key) do nothing;
