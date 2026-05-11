create table if not exists doctor_portal.doctor_roster_notifications (
  id bigserial primary key,
  roster_week_id bigint not null references doctor_portal.doctor_roster_weeks(id) on delete cascade,
  doctor_id bigint not null references doctor_portal.doctor_profiles(id) on delete cascade,
  notification_type text not null check (notification_type in ('roster_published')),
  status text not null default 'created' check (status in ('created', 'sent', 'failed')),
  sent_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  unique (roster_week_id, doctor_id, notification_type)
);

create index if not exists doctor_roster_notifications_week_idx
  on doctor_portal.doctor_roster_notifications(roster_week_id, status, created_at);

create index if not exists doctor_roster_notifications_doctor_idx
  on doctor_portal.doctor_roster_notifications(doctor_id, created_at desc);
