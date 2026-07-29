create index if not exists documents_reception_request_fingerprint_idx
  on documents(patient_id, file_size, content_sha256)
  where document_type = 'appointment_request'
    and source = 'request_scan_automation'
    and content_sha256 is not null;

create index if not exists documents_reception_request_legacy_fingerprint_idx
  on documents(patient_id, file_size)
  where document_type = 'appointment_request'
    and source = 'request_scan_automation'
    and content_sha256 is null;
