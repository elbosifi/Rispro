create table if not exists doctor_portal.doctor_availability (
  id bigserial primary key,
  doctor_id bigint not null references doctor_portal.doctor_profiles(id) on delete cascade,
  date date not null,
  start_time time,
  end_time time,
  availability_status text not null check (
    availability_status in (
      'available',
      'unavailable',
      'preferred',
      'not_preferred',
      'leave',
      'conference',
      'admin',
      'teaching',
      'on_call'
    )
  ),
  note text,
  created_by bigint references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time is null or start_time is null or end_time > start_time)
);

create index if not exists doctor_availability_doctor_date_idx
  on doctor_portal.doctor_availability(doctor_id, date);

create index if not exists doctor_availability_date_status_idx
  on doctor_portal.doctor_availability(date, availability_status);

create table if not exists doctor_portal.doctor_leave_requests (
  id bigserial primary key,
  doctor_id bigint not null references doctor_portal.doctor_profiles(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  leave_type text not null check (
    leave_type in (
      'annual_leave',
      'sick_leave',
      'conference',
      'study_leave',
      'admin_leave',
      'emergency_absence'
    )
  ),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reason text,
  approved_by bigint references users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create index if not exists doctor_leave_requests_doctor_dates_idx
  on doctor_portal.doctor_leave_requests(doctor_id, start_date, end_date);

create index if not exists doctor_leave_requests_status_idx
  on doctor_portal.doctor_leave_requests(status, start_date);
