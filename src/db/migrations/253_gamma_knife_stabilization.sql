alter table gamma_knife_operation_task_assignments
  add column status text not null default 'open'
    check (status in ('open','in_progress','resolved','cancelled'));

-- Keep one stable task key for follow-up work across legacy assignments and queues.
insert into gamma_knife_operation_task_assignments
  (episode_id,task_key,owner_user_id,due_date,priority,updated_by_user_id,status,updated_at)
select legacy.episode_id,'followup_booking',legacy.owner_user_id,legacy.due_date,legacy.priority,
       legacy.updated_by_user_id,legacy.status,legacy.updated_at
from gamma_knife_operation_task_assignments legacy
where legacy.task_key='followup'
on conflict (episode_id,task_key) do update set
  owner_user_id=coalesce(gamma_knife_operation_task_assignments.owner_user_id,excluded.owner_user_id),
  due_date=coalesce(gamma_knife_operation_task_assignments.due_date,excluded.due_date),
  priority=case when gamma_knife_operation_task_assignments.priority='normal' then excluded.priority else gamma_knife_operation_task_assignments.priority end,
  status=case when gamma_knife_operation_task_assignments.status='open' then excluded.status else gamma_knife_operation_task_assignments.status end,
  updated_at=greatest(gamma_knife_operation_task_assignments.updated_at,excluded.updated_at);
delete from gamma_knife_operation_task_assignments where task_key='followup';

create index gamma_knife_operation_task_owner_status_due
  on gamma_knife_operation_task_assignments(owner_user_id,status,priority,due_date,episode_id)
  where status in ('open','in_progress');

alter table gamma_knife_patient_attribution_corrections
  add column original_patient_snapshot jsonb,
  add column corrected_patient_snapshot jsonb;

update gamma_knife_patient_attribution_corrections c
set original_patient_snapshot = jsonb_build_object(
      'patientId', original.id,
      'mrn', original.mrn,
      'nationalId', original.national_id,
      'arabicFullName', original.arabic_full_name,
      'englishFullName', original.english_full_name,
      'sex', original.sex,
      'dateOfBirth', original.estimated_date_of_birth
    ),
    corrected_patient_snapshot = jsonb_build_object(
      'patientId', corrected.id,
      'mrn', corrected.mrn,
      'nationalId', corrected.national_id,
      'arabicFullName', corrected.arabic_full_name,
      'englishFullName', corrected.english_full_name,
      'sex', corrected.sex,
      'dateOfBirth', corrected.estimated_date_of_birth
    )
from patients original, patients corrected
where original.id = c.original_patient_id
  and corrected.id = c.corrected_patient_id;

alter table gamma_knife_patient_attribution_corrections
  alter column original_patient_id drop not null,
  alter column corrected_patient_id drop not null,
  alter column original_patient_snapshot set not null,
  alter column corrected_patient_snapshot set not null;

alter table gamma_knife_patient_attribution_corrections
  drop constraint if exists gamma_knife_patient_attribution_correc_original_patient_id_fkey,
  drop constraint if exists gamma_knife_patient_attribution_correc_corrected_patient_id_fkey;

alter table gamma_knife_patient_attribution_corrections
  add constraint gamma_knife_patient_attribution_original_patient_fk
    foreign key (original_patient_id) references patients(id) on delete set null,
  add constraint gamma_knife_patient_attribution_corrected_patient_fk
    foreign key (corrected_patient_id) references patients(id) on delete set null;

alter table gamma_knife_patient_identity_correction_requests
  add column patient_update_completed_at timestamptz,
  add column patient_update_completed_by_user_id bigint references users(id);

alter table gamma_knife_patient_identity_correction_requests
  add constraint gamma_knife_identity_update_completion_pair
  check ((patient_update_completed_at is null) = (patient_update_completed_by_user_id is null));

create index gamma_knife_identity_correction_handoff
  on gamma_knife_patient_identity_correction_requests(status,decided_at,id)
  where status = 'approved' and patient_update_completed_at is null;

create index gamma_knife_followup_plan_due
  on gamma_knife_episodes ((data->>'nextFollowupDate'), id)
  where active and status = 'followup' and data->>'nextFollowupDate' is not null;
