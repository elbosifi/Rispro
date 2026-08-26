create table appointments_v2.complementary_recall_requests (
  id bigserial primary key,
  original_appointment_id bigint not null references appointments_v2.bookings(id) on delete restrict,
  recall_appointment_id bigint references appointments_v2.bookings(id) on delete restrict,
  reception_instruction text,
  technologist_instruction text not null,
  status text not null,
  requested_by_user_id bigint not null references users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  reception_seen_at timestamptz,
  reception_seen_by_user_id bigint references users(id) on delete set null,
  scheduled_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by_user_id bigint references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint complementary_recall_requests_status_check
    check (status in ('pending_scheduling', 'scheduled', 'completed', 'cancelled')),
  constraint complementary_recall_requests_technologist_instruction_check
    check (length(trim(technologist_instruction)) > 0),
  constraint complementary_recall_requests_different_booking_check
    check (recall_appointment_id is null or recall_appointment_id <> original_appointment_id),
  constraint complementary_recall_requests_lifecycle_check
    check (
      (status = 'pending_scheduling' and recall_appointment_id is null and scheduled_at is null and completed_at is null and cancelled_at is null)
      or (status = 'scheduled' and recall_appointment_id is not null and scheduled_at is not null and completed_at is null and cancelled_at is null)
      or (status = 'completed' and recall_appointment_id is not null and completed_at is not null and cancelled_at is null)
      or (status = 'cancelled' and cancelled_at is not null)
    )
);

create unique index complementary_recall_requests_one_active_original_idx
  on appointments_v2.complementary_recall_requests(original_appointment_id)
  where status in ('pending_scheduling', 'scheduled');

create unique index complementary_recall_requests_recall_appointment_idx
  on appointments_v2.complementary_recall_requests(recall_appointment_id)
  where recall_appointment_id is not null;

create index complementary_recall_requests_reception_pending_idx
  on appointments_v2.complementary_recall_requests(status, reception_seen_at, requested_at desc);

create trigger trg_complementary_recall_requests_updated_at
before update on appointments_v2.complementary_recall_requests
for each row execute function touch_protocol_management_updated_at();
