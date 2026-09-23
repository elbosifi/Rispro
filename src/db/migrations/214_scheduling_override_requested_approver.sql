alter table appointments_v2.scheduling_override_requests
  add column if not exists requested_approver_user_id bigint references users(id);

create index if not exists scheduling_override_requests_requested_approver_idx
  on appointments_v2.scheduling_override_requests(requested_approver_user_id);
