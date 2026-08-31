alter table comparison_requests
  add column if not exists planned_reporting_doctor_id bigint references doctor_portal.doctor_profiles(id) on delete set null,
  add column if not exists planned_reporting_doctor_set_by bigint references users(id) on delete set null,
  add column if not exists planned_reporting_doctor_set_at timestamptz,
  add column if not exists documents_disposition text,
  add column if not exists preparation_returned_by bigint references users(id) on delete set null,
  add column if not exists preparation_returned_at timestamptz,
  add column if not exists preparation_return_reason text;

alter table comparison_requests
  drop constraint if exists comparison_requests_documents_disposition_check;

alter table comparison_requests
  add constraint comparison_requests_documents_disposition_check
  check (documents_disposition is null or documents_disposition in ('attached_verified', 'not_required'));
