-- Appointments V2 — Special quota user allow-list
--
-- Special quota rows are super_admin-only unless one or more users are
-- explicitly assigned here.

create table if not exists appointments_v2.exam_type_special_quota_users (
  quota_id bigint not null references appointments_v2.exam_type_special_quotas(id) on delete cascade,
  user_id bigint not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (quota_id, user_id)
);

create index if not exists v2_special_quota_users_user_lookup
  on appointments_v2.exam_type_special_quota_users(user_id);
