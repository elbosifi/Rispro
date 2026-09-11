-- Track the automated acquisition authority and the last observed PACS activity.
-- These fields are intentionally independent from the diagnostic PACS timing fields.

alter table appointments_v2.bookings
  add column if not exists acquisition_status_source text,
  add column if not exists pacs_last_activity_at timestamptz,
  add column if not exists pacs_last_observed_instance_count integer,
  add column if not exists pacs_last_observed_series_count integer,
  add column if not exists pacs_last_observed_orthanc_update_at timestamptz;

alter table appointments_v2.bookings
  drop constraint if exists bookings_acquisition_status_source_check;

alter table appointments_v2.bookings
  add constraint bookings_acquisition_status_source_check
  check (acquisition_status_source is null or acquisition_status_source in ('pacs', 'mpps'));
