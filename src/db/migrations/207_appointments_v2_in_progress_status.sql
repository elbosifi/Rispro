-- Allow the existing in-progress appointment workflow state for V2 bookings.
-- MPPS uses this state while a modality is actively performing the study.

alter table appointments_v2.bookings
  drop constraint if exists bookings_status_check;

alter table appointments_v2.bookings
  add constraint bookings_status_check
  check (status in ('scheduled', 'arrived', 'waiting', 'in-progress', 'completed', 'no-show', 'cancelled', 'discontinued', 'voided'));
