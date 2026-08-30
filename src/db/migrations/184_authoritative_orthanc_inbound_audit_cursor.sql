alter table dicom_transfer_events
  add column orthanc_change_sequence bigint,
  add column orthanc_resource_id text;

create index dicom_transfer_events_orthanc_change_sequence_idx
  on dicom_transfer_events (orthanc_change_sequence);

create table authoritative_orthanc_inbound_audit_state (
  singleton_key boolean primary key default true check (singleton_key),
  last_change_sequence bigint,
  last_success_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

insert into authoritative_orthanc_inbound_audit_state (singleton_key)
values (true)
on conflict (singleton_key) do nothing;
