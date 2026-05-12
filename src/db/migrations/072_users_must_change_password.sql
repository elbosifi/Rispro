alter table users
  add column if not exists must_change_password boolean not null default false;

create index if not exists users_must_change_password_idx
  on users(id)
  where must_change_password = true;
