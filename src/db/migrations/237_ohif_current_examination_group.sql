-- Keep the current examination independent of optional, lazily loaded history.
alter table viewer_launch_sessions
  add column current_study_uids jsonb not null default '[]'::jsonb
  check (jsonb_typeof(current_study_uids) = 'array');

update viewer_launch_sessions
set current_study_uids = jsonb_build_array(study_instance_uid);
