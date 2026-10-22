alter table users
  add column if not exists auth_version integer not null default 0;

alter table users
  add constraint users_auth_version_nonnegative_check
  check (auth_version >= 0);
