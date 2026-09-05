alter table appointments_v2.complementary_recall_requests
  add column if not exists requested_modality_id bigint references modalities(id) on delete restrict,
  add column if not exists requested_exam_type_id bigint references exam_types(id) on delete restrict,
  add column if not exists original_report_dependency text,
  add column if not exists dependency_resolved_at timestamptz,
  add column if not exists notify_on_arrival boolean not null default false,
  add column if not exists notify_on_imaging_completed boolean not null default false;

alter table appointments_v2.complementary_recall_requests
  drop constraint if exists complementary_recall_requests_original_report_dependency_check;
alter table appointments_v2.complementary_recall_requests
  add constraint complementary_recall_requests_original_report_dependency_check
  check (original_report_dependency is null or original_report_dependency in ('none', 'imaging_completed', 'report_finalized'));

create index if not exists complementary_recall_requests_dependency_idx
  on appointments_v2.complementary_recall_requests(recall_appointment_id, original_report_dependency)
  where dependency_resolved_at is null;

alter table document_appointment_links drop constraint if exists document_appointment_links_appointment_id_fkey;
alter table document_appointment_links add constraint document_appointment_links_appointment_id_fkey
  foreign key (appointment_id) references appointments_v2.bookings(id) on delete cascade;

alter table doctor_portal.reporting_board_notification_events
  drop constraint if exists reporting_board_notification_events_event_type_check;
alter table doctor_portal.reporting_board_notification_events
  add constraint reporting_board_notification_events_event_type_check
  check (event_type in (
    'reporting_case_assigned_to_me',
    'additional_imaging_patient_arrived',
    'additional_imaging_completed',
    'additional_imaging_report_finalized'
  ));

alter table documents drop constraint if exists documents_source_check;
alter table documents add constraint documents_source_check
  check (source in ('manual_upload', 'naps2_webscan', 'scanner_app', 'request_scan_automation', 'modality_scan_automation', 'complementary_recall_system'));
