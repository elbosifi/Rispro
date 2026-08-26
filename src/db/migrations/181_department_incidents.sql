create table department_incidents (
  id bigserial primary key,
  incident_type text not null check (incident_type in ('equipment','clinical_workflow')),
  occurred_at timestamptz not null,
  equipment_id bigint references equipment(id) on delete restrict,
  patient_id bigint references patients(id) on delete set null,
  equipment_condition text check (equipment_condition in ('operational','degraded','out_of_service')),
  clinical_category text check (clinical_category in ('wrong_patient','wrong_exam','wrong_protocol','acquisition_quality','contrast_event','delay','communication_failure','reporting_issue','other')),
  harm_level text check (harm_level in ('near_miss','no_harm','harm')),
  description text not null,
  immediate_action text,
  vendor_contacted boolean not null default false,
  vendor_contact_person text,
  vendor_reference text,
  status text not null default 'submitted' check (status in ('submitted','under_review','action_required','resolved','closed')),
  review_notes text,
  reported_by_user_id bigint references users(id) on delete set null,
  reviewed_by_user_id bigint references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((incident_type='equipment' and equipment_id is not null and equipment_condition is not null and clinical_category is null and harm_level is null) or (incident_type='clinical_workflow' and equipment_id is null and equipment_condition is null and clinical_category is not null and harm_level is not null))
);
create index department_incidents_occurred_at_idx on department_incidents(occurred_at desc);
create index department_incidents_status_idx on department_incidents(status);
create index department_incidents_type_idx on department_incidents(incident_type);
create index department_incidents_equipment_idx on department_incidents(equipment_id);
create index department_incidents_patient_idx on department_incidents(patient_id);
alter table documents add column incident_id bigint references department_incidents(id) on delete restrict;
create index documents_incident_id_idx on documents(incident_id);
create trigger trg_department_incidents_updated_at before update on department_incidents for each row execute function touch_protocol_management_updated_at();
