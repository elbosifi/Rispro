create table if not exists ir_referral_cases (
  id bigserial primary key,
  patient_id bigint not null references patients(id) on delete restrict,
  requested_procedure text not null,
  clinical_indication text,
  status text not null default 'preparing' check (status in (
    'preparing', 'ready_for_review', 'needs_information', 'appointment_requested',
    'scheduled', 'not_suitable', 'completed', 'cancelled'
  )),
  assigned_doctor_id bigint references doctor_portal.doctor_profiles(id) on delete set null,
  notify_assigned_doctor boolean not null default false,
  documents_confirmed boolean not null default false,
  images_confirmed boolean not null default false,
  materials_confirmed boolean not null default false,
  materials_confirmed_by bigint references users(id) on delete set null,
  materials_confirmed_at timestamptz,
  materials_confirmation_note text,
  assessment_text text,
  decision text check (decision in ('eligible_for_intervention', 'needs_information', 'not_suitable')),
  decision_note text,
  reviewed_by_doctor_id bigint references doctor_portal.doctor_profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_by_user_id bigint not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_by_user_id bigint references users(id) on delete set null,
  cancelled_at timestamptz,
  cancellation_reason text
);

create index if not exists ir_referral_cases_patient_created_idx
  on ir_referral_cases(patient_id, created_at desc);
create index if not exists ir_referral_cases_status_created_idx
  on ir_referral_cases(status, created_at desc);
create index if not exists ir_referral_cases_assigned_doctor_idx
  on ir_referral_cases(assigned_doctor_id, status, created_at desc)
  where assigned_doctor_id is not null;

create table if not exists ir_referral_documents (
  ir_referral_case_id bigint not null references ir_referral_cases(id) on delete restrict,
  document_id bigint not null references documents(id) on delete cascade,
  created_by bigint references users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (ir_referral_case_id, document_id)
);
create index if not exists ir_referral_documents_document_idx on ir_referral_documents(document_id);

create table if not exists doctor_portal.ir_referral_assignments (
  id bigserial primary key,
  ir_referral_case_id bigint not null references ir_referral_cases(id) on delete cascade,
  assigned_doctor_id bigint not null references doctor_portal.doctor_profiles(id) on delete restrict,
  assigned_by_user_id bigint references users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active', 'superseded', 'cancelled')),
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ir_referral_assignments_active_unique
  on doctor_portal.ir_referral_assignments(ir_referral_case_id) where status = 'active';
create index if not exists ir_referral_assignments_doctor_idx
  on doctor_portal.ir_referral_assignments(assigned_doctor_id) where status = 'active';

create table if not exists ir_referral_schedule_requests (
  id bigserial primary key,
  ir_referral_case_id bigint not null references ir_referral_cases(id) on delete restrict,
  requested_by_user_id bigint not null references users(id) on delete restrict,
  requested_modality_id bigint not null references modalities(id) on delete restrict,
  requested_exam_type_id bigint not null references exam_types(id) on delete restrict,
  preferred_date date,
  urgency text not null check (urgency in ('same_day', 'within_24_hours', 'within_72_hours', 'routine')),
  reception_instruction text,
  technologist_instruction text not null,
  status text not null default 'pending_scheduling' check (status in ('pending_scheduling', 'scheduled', 'cancelled')),
  appointment_id bigint references appointments_v2.bookings(id) on delete set null,
  requested_at timestamptz not null default now(),
  scheduled_at timestamptz,
  cancelled_at timestamptz
);
create index if not exists ir_referral_schedule_requests_pending_idx
  on ir_referral_schedule_requests(status, requested_at asc);
create unique index if not exists ir_referral_schedule_requests_one_pending_unique
  on ir_referral_schedule_requests(ir_referral_case_id) where status = 'pending_scheduling';
create unique index if not exists ir_referral_schedule_requests_appointment_unique
  on ir_referral_schedule_requests(appointment_id) where appointment_id is not null;

alter table dicom_remap_jobs
  add column if not exists ir_referral_case_id bigint references ir_referral_cases(id) on delete restrict;

alter table dicom_remap_jobs
  drop constraint if exists dicom_remap_jobs_single_request_context_check;
alter table dicom_remap_jobs
  add constraint dicom_remap_jobs_single_request_context_check
  check (comparison_request_id is null or ir_referral_case_id is null);
create index if not exists dicom_remap_jobs_ir_referral_case_created_idx
  on dicom_remap_jobs(ir_referral_case_id, created_at desc)
  where ir_referral_case_id is not null;

alter table doctor_portal.reporting_board_notification_events
  add column if not exists ir_referral_case_id bigint references ir_referral_cases(id) on delete cascade;

alter table doctor_portal.reporting_board_notification_events
  drop constraint if exists reporting_board_notification_events_event_type_check;
alter table doctor_portal.reporting_board_notification_events
  add constraint reporting_board_notification_events_event_type_check
  check (event_type in ('reporting_case_assigned_to_me', 'additional_imaging_patient_arrived', 'additional_imaging_completed', 'additional_imaging_report_finalized', 'ir_referral_ready_for_review'));

create index if not exists reporting_board_notifications_ir_referral_event_idx
  on doctor_portal.reporting_board_notification_events(ir_referral_case_id, event_type)
  where ir_referral_case_id is not null;
