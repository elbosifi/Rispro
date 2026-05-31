create table if not exists user_web_push_subscriptions (
  id bigserial primary key,
  user_id bigint not null references users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  subscription_hash text not null,
  user_agent text,
  enabled boolean not null default true,
  last_seen_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_web_push_subscriptions_user_hash_unique unique (user_id, subscription_hash)
);

create index if not exists user_web_push_subscriptions_user_enabled_idx
  on user_web_push_subscriptions(user_id, enabled);
