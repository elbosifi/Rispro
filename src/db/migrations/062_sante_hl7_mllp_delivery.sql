insert into system_settings (category, setting_key, setting_value)
values
  ('sante_worklist_hl7', 'delivery_method', '{"value":"file_drop"}'::jsonb),
  ('sante_worklist_hl7', 'mllp_host', '{"value":""}'::jsonb),
  ('sante_worklist_hl7', 'mllp_port', '{"value":""}'::jsonb),
  ('sante_worklist_hl7', 'mllp_timeout_seconds', '{"value":"10"}'::jsonb),
  ('sante_worklist_hl7', 'mllp_expect_ack', '{"value":"true"}'::jsonb),
  ('sante_worklist_hl7', 'scheduled_station_ae_title_default', '{"value":""}'::jsonb)
on conflict (category, setting_key) do nothing;

alter table sante_hl7_outbox
drop constraint if exists sante_hl7_outbox_status_check;

alter table sante_hl7_outbox
add constraint sante_hl7_outbox_status_check check (
  status in (
    'pending',
    'writing',
    'written',
    'pending_import',
    'imported_assumed',
    'imported_done',
    'import_failed',
    'pending_timeout',
    'retry_scheduled',
    'dead_letter',
    'skipped',
    'acknowledged',
    'nack_received',
    'send_failed'
  )
);

alter table sante_worklist_sync
drop constraint if exists sante_worklist_sync_sync_status_check;

alter table sante_worklist_sync
add constraint sante_worklist_sync_sync_status_check check (
  sync_status in (
    'pending',
    'written',
    'imported_assumed',
    'imported_done',
    'import_failed',
    'pending_timeout',
    'retry_scheduled',
    'dead_letter',
    'skipped',
    'acknowledged',
    'nack_received',
    'send_failed'
  )
);
