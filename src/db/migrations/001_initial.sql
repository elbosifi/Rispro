create table if not exists users (
  id bigserial primary key,
  username text not null unique,
  full_name text not null,
  password_hash text not null,
  role text not null check (role in ('receptionist', 'supervisor')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists patients (
  id bigserial primary key,
  mrn text unique,
  national_id varchar(13) not null unique,
  arabic_full_name text not null,
  english_full_name text not null,
  normalized_arabic_name text not null,
  age_years integer not null check (age_years >= 0 and age_years <= 130),
  estimated_date_of_birth date,
  sex text not null,
  phone_1 varchar(11) not null,
  phone_2 varchar(11),
  address text,
  created_by_user_id bigint references users(id),
  updated_by_user_id bigint references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists reporting_priorities (
  id bigserial primary key,
  code text not null unique,
  name_ar text not null,
  name_en text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists modalities (
  id bigserial primary key,
  code text not null unique,
  name_ar text not null,
  name_en text not null,
  daily_capacity integer not null default 0,
  general_instruction_ar text,
  general_instruction_en text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists exam_types (
  id bigserial primary key,
  modality_id bigint not null references modalities(id) on delete cascade,
  name_ar text not null,
  name_en text not null,
  specific_instruction_ar text,
  specific_instruction_en text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists appointments (
  id bigserial primary key,
  patient_id bigint not null references patients(id) on delete restrict,
  modality_id bigint not null references modalities(id) on delete restrict,
  exam_type_id bigint references exam_types(id) on delete restrict,
  reporting_priority_id bigint references reporting_priorities(id) on delete restrict,
  accession_number text not null unique,
  appointment_date date not null,
  daily_sequence integer not null,
  status text not null default 'scheduled',
  is_walk_in boolean not null default false,
  is_overbooked boolean not null default false,
  overbooking_reason text,
  approved_by_name text,
  notes text,
  no_show_reason text,
  cancel_reason text,
  arrived_at timestamptz,
  completed_at timestamptz,
  created_by_user_id bigint references users(id),
  updated_by_user_id bigint references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointments_status_check check (
    status in ('scheduled', 'arrived', 'waiting', 'completed', 'no-show', 'cancelled')
  ),
  constraint appointments_unique_sequence unique (appointment_date, daily_sequence)
);

create table if not exists appointment_status_history (
  id bigserial primary key,
  appointment_id bigint not null references appointments(id) on delete cascade,
  old_status text,
  new_status text not null,
  changed_by_user_id bigint references users(id),
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists patient_custom_fields (
  id bigserial primary key,
  field_key text not null unique,
  label_ar text not null,
  label_en text not null,
  field_type text not null,
  is_visible boolean not null default true,
  is_required boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists patient_custom_values (
  id bigserial primary key,
  patient_id bigint not null references patients(id) on delete cascade,
  field_id bigint not null references patient_custom_fields(id) on delete cascade,
  value_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists name_dictionary (
  id bigserial primary key,
  arabic_text text not null unique,
  english_text text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists documents (
  id bigserial primary key,
  patient_id bigint references patients(id) on delete cascade,
  appointment_id bigint references appointments(id) on delete cascade,
  document_type text not null,
  original_filename text not null,
  stored_path text not null,
  mime_type text,
  file_size bigint,
  uploaded_by_user_id bigint references users(id),
  created_at timestamptz not null default now()
);

create table if not exists system_settings (
  id bigserial primary key,
  category text not null,
  setting_key text not null,
  setting_value jsonb not null default '{}'::jsonb,
  updated_by_user_id bigint references users(id),
  updated_at timestamptz not null default now(),
  constraint system_settings_unique_key unique (category, setting_key)
);

create table if not exists backup_runs (
  id bigserial primary key,
  backup_name text not null,
  storage_type text not null,
  storage_path text,
  initiated_by_user_id bigint references users(id),
  created_at timestamptz not null default now()
);

create table if not exists audit_log (
  id bigserial primary key,
  entity_type text not null,
  entity_id bigint,
  action_type text not null,
  old_values jsonb,
  new_values jsonb,
  changed_by_user_id bigint references users(id),
  created_at timestamptz not null default now()
);

insert into reporting_priorities (code, name_ar, name_en, sort_order)
values
  ('routine', 'روتيني', 'Routine', 1),
  ('urgent', 'مستعجل', 'Urgent', 2),
  ('stat', 'عاجل جداً', 'STAT', 3)
on conflict (code) do nothing;
