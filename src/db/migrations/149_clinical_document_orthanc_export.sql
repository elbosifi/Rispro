create table if not exists clinical_document_exports (
  id bigserial primary key,
  document_id bigint not null references documents(id) on delete cascade,
  appointment_id bigint not null references appointments_v2.bookings(id) on delete cascade,
  destination_key text not null default 'authoritative_orthanc',
  status text not null default 'pending',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_retry_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  orthanc_study_id text,
  orthanc_series_id text,
  orthanc_instance_id text,
  study_instance_uid text,
  series_instance_uid text,
  sop_instance_uid text,
  exported_at timestamptz,
  verified_at timestamptz,
  export_lease_owner text,
  export_lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clinical_document_exports_status_check
    check (status in ('pending', 'exporting', 'exported', 'failed', 'blocked'))
);

create unique index if not exists clinical_document_exports_document_appointment_destination_key
  on clinical_document_exports(document_id, appointment_id, destination_key);

create index if not exists clinical_document_exports_due_idx
  on clinical_document_exports(status, next_retry_at, created_at);

create index if not exists clinical_document_exports_appointment_idx
  on clinical_document_exports(appointment_id, created_at desc);

create index if not exists clinical_document_exports_sop_uid_idx
  on clinical_document_exports(sop_instance_uid)
  where sop_instance_uid is not null;
