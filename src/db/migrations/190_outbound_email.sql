create table if not exists email_smtp_configuration (
  id smallint primary key check (id = 1),
  enabled boolean not null default false,
  sender_name text not null default '', sender_email text not null default '', reply_to_email text,
  smtp_host text not null default '', smtp_port integer not null default 465 check (smtp_port between 1 and 65535),
  security_mode text not null default 'tls' check (security_mode in ('tls', 'starttls')),
  smtp_username text not null default '', smtp_password_secret jsonb,
  connection_timeout_seconds integer not null default 10 check (connection_timeout_seconds between 3 and 60),
  updated_by_user_id bigint references users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
insert into email_smtp_configuration (id) values (1) on conflict (id) do nothing;

create table if not exists email_outbox (
  id bigserial primary key, event_type text not null, recipient_user_id bigint references users(id) on delete set null,
  recipient_email text not null, subject text not null, text_body text not null,
  status text not null default 'pending' check (status in ('pending','processing','retry_scheduled','accepted','failed')),
  attempt_count integer not null default 0, max_attempts integer not null default 4,
  next_attempt_at timestamptz not null default now(), locked_at timestamptz, last_attempt_at timestamptz,
  accepted_at timestamptz, smtp_message_id text, smtp_response text, last_error_code text, last_error_summary text,
  idempotency_key text not null unique, related_entity_type text, related_entity_id text,
  created_by_user_id bigint references users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists email_outbox_due_idx on email_outbox (status, next_attempt_at, id);
create index if not exists email_outbox_history_idx on email_outbox (created_at desc, id desc);
