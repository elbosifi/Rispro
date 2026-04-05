-- Add indexes to support the calendar summary and day detail queries.
-- These indexes speed up date-range scans and modality-filtered lookups
-- without changing any schema or constraints.

-- Primary index for date-range scans (used by calendar-summary)
create index concurrently if not exists idx_appointments_appointment_date
  on appointments (appointment_date);

-- Composite index for modality-filtered calendar queries
create index concurrently if not exists idx_appointments_date_modality
  on appointments (appointment_date, modality_id);
