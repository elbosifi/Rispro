alter table sante_hl7_outbox
add column if not exists projection_json jsonb;

alter table sante_worklist_sync
add column if not exists last_projection_json jsonb;

update sante_worklist_sync s
set last_projection_json = jsonb_build_object(
  'id', b.id,
  'patient_id', b.patient_id,
  'patient_primary_id', p.identifier_value,
  'mrn', p.mrn,
  'national_id', p.national_id,
  'phone_1', p.phone_1,
  'address', p.address,
  'arabic_full_name', p.arabic_full_name,
  'english_full_name', p.english_full_name,
  'estimated_date_of_birth', p.estimated_date_of_birth::text,
  'sex', p.sex,
  'modality_code', m.code,
  'modality_name_en', m.name_en,
  'modality_name_ar', m.name_ar,
  'exam_type_code', et.code,
  'exam_name_en', et.name_en,
  'exam_name_ar', et.name_ar,
  'protocol_text', ap.protocol_text,
  'contrast_required', ap.contrast_required,
  'contrast_phase_or_protocol', ap.contrast_phase_or_protocol,
  'booking_date', b.booking_date::text,
  'booking_time', b.booking_time::text,
  'status', b.status
)
from appointments_v2.bookings b
join patients p on p.id = b.patient_id
join modalities m on m.id = b.modality_id
left join exam_types et on et.id = b.exam_type_id
left join doctor_portal.appointment_protocols ap on ap.appointment_id = b.id and ap.protocol_status = 'assigned'
where s.booking_id = b.id
  and s.sync_status <> 'skipped'
  and s.last_projection_json is null;
