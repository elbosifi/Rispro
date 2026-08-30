create table authoritative_orthanc_inbound_pending_instances (
  change_sequence bigint primary key,
  orthanc_instance_id text not null,
  change_date timestamptz,
  created_at timestamptz not null default now()
);

create index authoritative_orthanc_inbound_pending_instances_instance_id_idx
  on authoritative_orthanc_inbound_pending_instances (orthanc_instance_id);

create index authoritative_orthanc_inbound_pending_instances_created_at_idx
  on authoritative_orthanc_inbound_pending_instances (created_at);
