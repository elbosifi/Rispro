alter table appointments_v2.no_show_worker_state
  add column if not exists last_today_processed_count integer not null default 0,
  add column if not exists last_historical_processed_count integer not null default 0,
  add column if not exists last_skipped_count integer not null default 0;

alter table appointments_v2.no_show_worker_state
  drop column if exists last_processed_count;
