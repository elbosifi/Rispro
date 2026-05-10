alter table documents
  add column if not exists source text not null default 'manual_upload';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'documents_source_check'
  ) then
    alter table documents
      add constraint documents_source_check
      check (source in ('manual_upload', 'naps2_webscan'));
  end if;
end $$;

insert into system_settings (category, setting_key, setting_value)
values
  ('documents_and_uploads', 'naps2_webscan_enabled', '{"value":"disabled"}'::jsonb),
  ('documents_and_uploads', 'naps2_webscan_endpoint', '{"value":""}'::jsonb)
on conflict (category, setting_key) do nothing;
