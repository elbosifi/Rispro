create table if not exists doctor_portal.reporting_board_notification_events (
  id bigserial primary key,
  saved_view_id bigint references doctor_portal.reporting_board_saved_views(id) on delete cascade,
  recipient_user_id bigint references users(id) on delete cascade,
  recipient_doctor_id bigint references doctor_portal.doctor_profiles(id) on delete cascade,
  appointment_id bigint references appointments_v2.bookings(id) on delete cascade,
  event_type text not null check (event_type in ('reporting_case_assigned_to_me')),
  delivery_channel text not null default 'in_app' check (delivery_channel in ('in_app')),
  status text not null default 'pending' check (status in ('pending', 'delivered', 'read', 'dismissed', 'failed')),
  title text not null,
  body text not null,
  action_url text,
  dedupe_key text not null unique,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  read_at timestamptz,
  dismissed_at timestamptz,
  error text
);

create index if not exists reporting_board_notifications_recipient_status_idx
  on doctor_portal.reporting_board_notification_events(recipient_user_id, status, created_at desc);

create index if not exists reporting_board_notifications_doctor_created_idx
  on doctor_portal.reporting_board_notification_events(recipient_doctor_id, created_at desc);

create index if not exists reporting_board_notifications_saved_view_created_idx
  on doctor_portal.reporting_board_notification_events(saved_view_id, created_at desc);

create index if not exists reporting_board_notifications_appointment_event_idx
  on doctor_portal.reporting_board_notification_events(appointment_id, event_type);
