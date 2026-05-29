create table if not exists doctor_portal.reporting_board_web_push_subscriptions (
  id bigserial primary key,
  saved_view_id bigint not null references doctor_portal.reporting_board_saved_views(id) on delete cascade,
  user_id bigint not null references users(id) on delete cascade,
  doctor_id bigint references doctor_portal.doctor_profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  subscription_hash text not null,
  user_agent text,
  enabled boolean not null default true,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reporting_board_web_push_saved_view_hash_unique unique (saved_view_id, subscription_hash)
);

create index if not exists reporting_board_web_push_saved_view_idx
  on doctor_portal.reporting_board_web_push_subscriptions(saved_view_id, enabled);

create index if not exists reporting_board_web_push_user_idx
  on doctor_portal.reporting_board_web_push_subscriptions(user_id, enabled);
