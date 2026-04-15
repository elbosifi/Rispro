-- Appointments V2 — Persist special quota metadata on bookings
--
-- Adds optional audit/justification metadata fields. These do not affect
-- evaluator/rule behavior.

alter table if exists appointments_v2.bookings
  add column if not exists special_reason_code text,
  add column if not exists special_reason_note text;

