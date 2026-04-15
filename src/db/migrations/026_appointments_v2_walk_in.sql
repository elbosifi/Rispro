-- ---------------------------------------------------------------------------
-- Appointments V2 — Add is_walk_in column to bookings
-- ---------------------------------------------------------------------------
-- The booking service writes is_walk_in but the column was never added to
-- the appointments_v2.bookings table. This fixes the schema gap.
-- ---------------------------------------------------------------------------

alter table appointments_v2.bookings
  add column if not exists is_walk_in boolean not null default false;
