create table if not exists document_ha_blobs (
    document_id bigint primary key
        references documents(id) on delete cascade,

    content bytea not null,
    byte_size bigint not null,
    content_sha256 text not null,

    created_at timestamptz not null default now(),
    retention_due_at timestamptz not null,

    reconciliation_lease_owner text,
    reconciliation_lease_expires_at timestamptz,

    constraint document_ha_blobs_byte_size_check
        check (byte_size > 0),

    constraint document_ha_blobs_sha256_check
        check (content_sha256 ~ '^[0-9a-f]{64}$'),

    constraint document_ha_blobs_retention_check
        check (retention_due_at > created_at)
);

alter table document_ha_blobs
  add column if not exists reconciliation_lease_owner text,
  add column if not exists reconciliation_lease_expires_at timestamptz;

create index if not exists document_ha_blobs_retention_due_at_idx
  on document_ha_blobs(retention_due_at);

insert into system_settings (category, setting_key, setting_value)
values
  ('documents_and_uploads', 'ha_hot_storage_enabled', '{"value":"true"}'::jsonb),
  ('documents_and_uploads', 'ha_hot_storage_retention_hours', '{"value":"48"}'::jsonb)
on conflict (category, setting_key) do nothing;
