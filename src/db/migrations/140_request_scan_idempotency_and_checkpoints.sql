alter table documents
  add column if not exists idempotency_key text,
  add column if not exists request_scan_job_id bigint references request_scan_jobs(id) on delete set null;

with canonical as (
  select distinct on (v2_booking_id) id, v2_booking_id
  from documents
  where source='request_scan_automation' and document_type='appointment_request' and v2_booking_id is not null
  order by v2_booking_id, id
)
update documents d set idempotency_key='request-scan:v2-booking:' || canonical.v2_booking_id::text || ':appointment-request'
from canonical where d.id=canonical.id and d.idempotency_key is null;

create unique index if not exists documents_request_scan_idempotency_key_unique
  on documents(idempotency_key) where idempotency_key is not null;

alter table request_scan_jobs
  add column if not exists attachment_completed_at timestamptz,
  add column if not exists attachment_created boolean,
  add column if not exists intended_destination_path text,
  add column if not exists source_moved_at timestamptz;
