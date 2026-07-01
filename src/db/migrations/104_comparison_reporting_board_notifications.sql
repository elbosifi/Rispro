alter table doctor_portal.reporting_board_notification_events
  add column if not exists comparison_request_id bigint references comparison_requests(id) on delete cascade;

create index if not exists reporting_board_notifications_comparison_event_idx
  on doctor_portal.reporting_board_notification_events(comparison_request_id, event_type);
