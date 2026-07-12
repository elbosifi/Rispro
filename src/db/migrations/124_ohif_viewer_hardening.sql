alter table viewer_launch_sessions
  add column if not exists viewer_session_token_hash text;

create unique index if not exists viewer_launch_sessions_viewer_session_token_hash_idx
  on viewer_launch_sessions(viewer_session_token_hash)
  where viewer_session_token_hash is not null;

alter table ohif_retrieval_jobs
  add column if not exists preexisting_orthanc_study_ids jsonb not null default '[]'::jsonb,
  add column if not exists owned_orthanc_study_id text,
  add column if not exists cache_ownership_proven boolean not null default false;

create index if not exists ohif_retrieval_jobs_owned_cache_study_idx
  on ohif_retrieval_jobs(owned_orthanc_study_id)
  where cache_ownership_proven = true;
