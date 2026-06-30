create table if not exists comparison_requests (
  id bigserial primary key,
  patient_id bigint not null references patients(id) on delete restrict,
  linked_previous_booking_id bigint not null references appointments_v2.bookings(id) on delete restrict,
  linked_previous_study_uid text,
  linked_previous_accession_number text,
  linked_modality_id bigint references modalities(id) on delete restrict,
  linked_modality_code text,
  linked_exam_type_id bigint references exam_types(id) on delete set null,
  linked_exam_name text,
  linked_study_date date,
  reason text not null,
  status text not null default 'pending_upload_confirmation' check (
    status in ('pending_upload_confirmation', 'ready_for_reporting', 'assigned', 'finalized', 'cancelled')
  ),
  materials_confirmed boolean not null default false,
  materials_confirmed_by bigint references users(id) on delete set null,
  materials_confirmed_at timestamptz,
  materials_confirmation_note text,
  image_availability_confirmed boolean not null default false,
  documents_availability_confirmed boolean not null default false,
  selected_prior_confirmed boolean not null default false,
  assigned_doctor_id bigint references doctor_portal.doctor_profiles(id) on delete set null,
  finalized_by bigint references users(id) on delete set null,
  finalized_at timestamptz,
  final_text text,
  created_by bigint references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_by bigint references users(id) on delete set null,
  cancelled_at timestamptz,
  cancellation_reason text
);

create index if not exists comparison_requests_patient_idx
  on comparison_requests(patient_id, created_at desc);

create index if not exists comparison_requests_status_idx
  on comparison_requests(status, created_at desc);

create index if not exists comparison_requests_reporting_pool_idx
  on comparison_requests(linked_modality_id, status, created_at desc)
  where status in ('ready_for_reporting', 'assigned', 'finalized');

create table if not exists doctor_portal.comparison_case_assignments (
  id bigserial primary key,
  comparison_request_id bigint not null references comparison_requests(id) on delete cascade,
  assigned_doctor_id bigint not null references doctor_portal.doctor_profiles(id) on delete restrict,
  modality_id bigint not null references modalities(id) on delete restrict,
  assigned_by_user_id bigint references users(id) on delete set null,
  assigned_by_doctor_id bigint references doctor_portal.doctor_profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active', 'superseded', 'cancelled')),
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists comparison_case_assignments_active_unique
  on doctor_portal.comparison_case_assignments(comparison_request_id)
  where status = 'active';

create index if not exists comparison_case_assignments_doctor_idx
  on doctor_portal.comparison_case_assignments(assigned_doctor_id)
  where status = 'active';

create index if not exists comparison_case_assignments_modality_idx
  on doctor_portal.comparison_case_assignments(modality_id)
  where status = 'active';
