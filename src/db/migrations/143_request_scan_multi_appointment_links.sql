create table if not exists document_appointment_links (
  document_id bigint not null references documents(id) on delete cascade,
  appointment_id bigint not null references appointments_v2.bookings(id),
  created_at timestamptz not null default now(),
  primary key (document_id, appointment_id)
);

create index if not exists document_appointment_links_appointment_idx
  on document_appointment_links(appointment_id, document_id);

create table if not exists request_scan_job_appointments (
  request_scan_job_id bigint not null references request_scan_jobs(id) on delete cascade,
  appointment_id bigint not null references appointments_v2.bookings(id),
  patient_id bigint not null references patients(id),
  identifier_source text not null check (identifier_source in ('accession', 'qr', 'consensus', 'filename', 'checkpoint')),
  created_at timestamptz not null default now(),
  primary key (request_scan_job_id, appointment_id)
);

create index if not exists request_scan_job_appointments_appointment_idx
  on request_scan_job_appointments(appointment_id, request_scan_job_id);

insert into document_appointment_links(document_id, appointment_id)
select id, v2_booking_id
from documents
where v2_booking_id is not null
on conflict do nothing;

insert into request_scan_job_appointments(request_scan_job_id, appointment_id, patient_id, identifier_source)
select j.id, j.appointment_id, b.patient_id, 'checkpoint'
from request_scan_jobs j
join appointments_v2.bookings b on b.id=j.appointment_id
where j.appointment_id is not null
on conflict do nothing;

with duplicate_jobs as (
  select id, row_number() over(partition by request_scan_job_id order by id) as position
  from documents
  where request_scan_job_id is not null
)
update documents d
set request_scan_job_id=null
from duplicate_jobs duplicate
where d.id=duplicate.id and duplicate.position>1;

create unique index if not exists documents_request_scan_job_unique
  on documents(request_scan_job_id)
  where request_scan_job_id is not null;
