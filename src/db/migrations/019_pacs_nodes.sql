-- Migration 019: PACS nodes table and advanced search support
-- Replaces single PACS connection settings with multi-node support

create table if not exists pacs_nodes (
  id bigserial primary key,
  name text not null,
  host text not null,
  port integer not null default 104,
  called_ae_title text not null,
  calling_ae_title text not null default 'RISPRO',
  timeout_seconds integer not null default 10,
  is_active boolean not null default true,
  is_default boolean not null default false,
  created_by_user_id bigint references users(id),
  updated_by_user_id bigint references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pacs_nodes_is_active_idx
  on pacs_nodes (is_active);

create index if not exists pacs_nodes_is_default_idx
  on pacs_nodes (is_default);

-- Ensure only one default node
create unique index pacs_nodes_single_default_idx
  on pacs_nodes (is_default)
  where is_default = true;

-- Migrate existing pacs_connection settings into a default node
-- Note: AE titles are uppercased since DICOM requires uppercase
insert into pacs_nodes (name, host, port, called_ae_title, calling_ae_title, timeout_seconds, is_active, is_default)
select
  'Primary PACS',
  coalesce((select setting_value->>'value' from system_settings where category = 'pacs_connection' and setting_key = 'host'), '192.9.101.164'),
  coalesce(nullif((select setting_value->>'value' from system_settings where category = 'pacs_connection' and setting_key = 'port'), '')::integer, 103),
  upper(coalesce((select setting_value->>'value' from system_settings where category = 'pacs_connection' and setting_key = 'called_ae_title'), 'OSIRIXR')),
  upper(coalesce((select setting_value->>'value' from system_settings where category = 'pacs_connection' and setting_key = 'calling_ae_title'), 'RISPRO')),
  coalesce(nullif((select setting_value->>'value' from system_settings where category = 'pacs_connection' and setting_key = 'timeout_seconds'), '')::integer, 10),
  true,
  true
where not exists (select 1 from pacs_nodes limit 1);
