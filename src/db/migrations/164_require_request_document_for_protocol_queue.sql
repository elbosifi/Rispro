insert into system_settings (category, setting_key, setting_value)
values (
  'documents_and_uploads',
  'require_request_document_for_protocol_queue',
  '{"value":"disabled"}'::jsonb
)
on conflict (category, setting_key) do nothing;
