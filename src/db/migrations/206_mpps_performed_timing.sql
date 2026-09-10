alter table mpps_event_log
  add column if not exists performed_start_date text,
  add column if not exists performed_start_time text,
  add column if not exists performed_end_date text,
  add column if not exists performed_end_time text,
  add column if not exists discontinuation_reason text;
