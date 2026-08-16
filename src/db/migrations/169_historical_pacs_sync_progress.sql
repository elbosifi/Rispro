alter table historical_pacs_sync_state
  add column sync_run_status text not null default 'idle'
    check (sync_run_status in ('idle', 'running', 'failed')),
  add column sync_mode text
    check (sync_mode in ('full', 'incremental')),
  add column sync_started_at timestamptz,
  add column sync_progress_at timestamptz,
  add column sync_processed integer not null default 0
    check (sync_processed >= 0),
  add column sync_total integer
    check (sync_total >= 0),
  add column last_observed_orthanc_study_count integer
    check (last_observed_orthanc_study_count >= 0);
