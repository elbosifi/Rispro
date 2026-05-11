create table if not exists doctor_portal.appointment_protocols (
  id bigserial primary key,
  appointment_id bigint not null references appointments_v2.bookings(id) on delete cascade,
  protocol_text text,
  contrast_required boolean,
  contrast_phase_or_protocol text,
  special_preparation text,
  technologist_notes text,
  protocol_status text not null default 'draft' check (
    protocol_status in ('draft', 'assigned', 'clarification_needed', 'cancelled')
  ),
  assigned_by_doctor_id bigint references doctor_portal.doctor_profiles(id) on delete set null,
  assigned_at timestamptz,
  updated_by_doctor_id bigint references doctor_portal.doctor_profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  unique (appointment_id)
);

create index if not exists appointment_protocols_appointment_idx
  on doctor_portal.appointment_protocols(appointment_id);

create index if not exists appointment_protocols_status_idx
  on doctor_portal.appointment_protocols(protocol_status);

create index if not exists appointment_protocols_assigned_by_idx
  on doctor_portal.appointment_protocols(assigned_by_doctor_id);

create index if not exists appointment_protocols_updated_by_idx
  on doctor_portal.appointment_protocols(updated_by_doctor_id);

create table if not exists doctor_portal.appointment_protocol_audit_events (
  id bigserial primary key,
  appointment_protocol_id bigint not null references doctor_portal.appointment_protocols(id) on delete cascade,
  appointment_id bigint not null references appointments_v2.bookings(id) on delete cascade,
  changed_by_doctor_id bigint references doctor_portal.doctor_profiles(id) on delete set null,
  event_type text not null check (
    event_type in (
      'protocol_created',
      'protocol_updated',
      'protocol_assigned',
      'clarification_requested',
      'protocol_cancelled',
      'protocol_corrected'
    )
  ),
  old_value_json jsonb,
  new_value_json jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists appointment_protocol_audit_protocol_idx
  on doctor_portal.appointment_protocol_audit_events(appointment_protocol_id, created_at desc);

create index if not exists appointment_protocol_audit_appointment_idx
  on doctor_portal.appointment_protocol_audit_events(appointment_id, created_at desc);
