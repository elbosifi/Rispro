alter table request_scan_job_appointments
  drop constraint if exists request_scan_job_appointments_identifier_source_check;

alter table request_scan_job_appointments
  add constraint request_scan_job_appointments_identifier_source_check
  check (identifier_source in ('accession', 'qr', 'consensus', 'filename', 'checkpoint', 'manual'));
