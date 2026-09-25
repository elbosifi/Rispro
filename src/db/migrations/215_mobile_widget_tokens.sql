create table mobile_widget_tokens (
  id bigserial primary key,
  device_name text not null check (length(device_name) between 1 and 100),
  token_hash text not null unique check (length(token_hash) = 64),
  token_prefix text not null,
  scope text not null,
  created_by_user_id bigint not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by_user_id bigint references users(id) on delete set null,
  replaced_by_id bigint references mobile_widget_tokens(id) on delete set null,
  check (expires_at > created_at)
);
create index mobile_widget_tokens_creator_idx on mobile_widget_tokens(created_by_user_id);
