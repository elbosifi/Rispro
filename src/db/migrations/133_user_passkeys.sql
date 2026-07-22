create table if not exists user_passkeys (
  id bigserial primary key,
  user_id bigint not null references users(id) on delete cascade,
  credential_id text not null unique,
  public_key bytea not null,
  counter bigint not null default 0,
  device_type text,
  backed_up boolean,
  transports jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists user_passkeys_user_id_idx on user_passkeys(user_id);
