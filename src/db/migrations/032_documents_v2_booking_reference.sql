alter table documents
  add column if not exists v2_booking_id bigint references appointments_v2.bookings(id) on delete cascade;

create index if not exists documents_v2_booking_id_idx
  on documents(v2_booking_id);
