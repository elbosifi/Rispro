alter table documents
  add column if not exists storage_location_type text not null default 'local_fallback',
  add column if not exists last_move_attempt_at timestamptz,
  add column if not exists last_move_error text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'documents_storage_location_type_check'
  ) then
    alter table documents
      add constraint documents_storage_location_type_check
      check (storage_location_type in ('network', 'local_fallback'));
  end if;
end $$;

insert into system_settings (category, setting_key, setting_value)
values
  ('documents_and_uploads', 'storage_path', '{"value":""}'::jsonb),
  ('documents_and_uploads', 'storage_auth_username', '{"value":""}'::jsonb),
  ('documents_and_uploads', 'storage_auth_password', '{"value":""}'::jsonb),
  ('documents_and_uploads', 'storage_auth_domain', '{"value":""}'::jsonb),
  ('documents_and_uploads', 'storage_fallback_enabled', '{"value":"true"}'::jsonb)
on conflict (category, setting_key) do nothing;
