alter table users
  add column if not exists email text;

update users
set email = btrim(username)
where email is null
  and btrim(username) ~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$';

create table if not exists email_notification_rules (
  event_type text primary key,
  enabled boolean not null default false,
  updated_by_user_id bigint references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into email_notification_rules (event_type, enabled)
values ('additional_imaging_completed', false)
on conflict (event_type) do nothing;
