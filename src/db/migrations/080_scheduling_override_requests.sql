create table if not exists appointments_v2.scheduling_override_requests (
  id bigserial primary key,
  request_type text not null check (request_type in ('create_booking', 'reschedule_booking')),
  override_type text not null check (override_type in ('closed_weekday_override', 'category_override', 'total_capacity_override')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled', 'failed', 'expired')),
  requester_user_id bigint not null references users(id),
  approver_user_id bigint references users(id),
  patient_id bigint not null references patients(id) on delete cascade,
  modality_id bigint not null references modalities(id),
  exam_type_id bigint references exam_types(id),
  requested_booking_date date not null,
  requested_booking_time time,
  booking_id bigint references appointments_v2.bookings(id) on delete cascade,
  requested_policy_version_id bigint references appointments_v2.policy_versions(id),
  approved_policy_version_id bigint references appointments_v2.policy_versions(id),
  request_payload_json jsonb not null,
  original_decision_snapshot_json jsonb not null,
  approval_decision_snapshot_json jsonb,
  requester_reason text not null check (length(btrim(requester_reason)) > 0),
  approver_reason text,
  failure_code text,
  failure_message text,
  expires_at timestamptz not null,
  superseded_by_request_id bigint references appointments_v2.scheduling_override_requests(id),
  created_from_context text,
  approved_at timestamptz,
  rejected_at timestamptz,
  cancelled_at timestamptz,
  failed_at timestamptz,
  expired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (request_type = 'reschedule_booking' and booking_id is not null)
    or (request_type = 'create_booking' and booking_id is null)
  )
);

create index if not exists scheduling_override_requests_status_idx
  on appointments_v2.scheduling_override_requests(status);

create index if not exists scheduling_override_requests_requester_idx
  on appointments_v2.scheduling_override_requests(requester_user_id);

create index if not exists scheduling_override_requests_approver_idx
  on appointments_v2.scheduling_override_requests(approver_user_id);

create index if not exists scheduling_override_requests_requested_date_idx
  on appointments_v2.scheduling_override_requests(requested_booking_date);

create index if not exists scheduling_override_requests_modality_idx
  on appointments_v2.scheduling_override_requests(modality_id);

create index if not exists scheduling_override_requests_booking_idx
  on appointments_v2.scheduling_override_requests(booking_id);

create index if not exists scheduling_override_requests_created_at_idx
  on appointments_v2.scheduling_override_requests(created_at);
