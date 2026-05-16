alter table sante_worklist_sync
add column if not exists last_projection_json jsonb;
