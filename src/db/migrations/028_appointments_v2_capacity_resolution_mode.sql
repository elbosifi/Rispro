-- Appointments V2: explicit capacity resolution mode.
--
-- Keeps booking semantics explicit and auditable:
-- - standard
-- - category_override
-- - special_quota_extra

alter table appointments_v2.bookings
  add column if not exists capacity_resolution_mode text
    not null
    default 'standard'
    check (capacity_resolution_mode in ('standard', 'category_override', 'special_quota_extra'));

create index if not exists v2_bookings_capacity_resolution_mode_idx
  on appointments_v2.bookings (capacity_resolution_mode);
