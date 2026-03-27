alter table appointments
add column if not exists modality_slot_number integer;

update appointments
set modality_slot_number = daily_sequence
where modality_slot_number is null;

alter table appointments
alter column modality_slot_number set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'appointments_unique_modality_slot'
  ) then
    alter table appointments
    add constraint appointments_unique_modality_slot unique (modality_id, appointment_date, modality_slot_number);
  end if;
end $$;

insert into modalities (code, name_ar, name_en, daily_capacity, general_instruction_ar, general_instruction_en)
values
  ('MRI', 'الرنين المغناطيسي', 'MRI', 10, 'إزالة المعادن قبل الفحص واتباع تعليمات القسم.', 'Remove metal items before the study and follow MRI unit instructions.'),
  ('CT', 'الأشعة المقطعية', 'CT', 10, 'يرجى الالتزام بتعليمات الصيام أو الصبغة إذا طُلب ذلك.', 'Follow fasting or contrast instructions if requested.'),
  ('US', 'الموجات فوق الصوتية', 'Ultrasound', 12, 'اتبع تعليمات التحضير الخاصة بالفحص.', 'Follow the exam preparation instructions.'),
  ('XR', 'الأشعة السينية', 'X-Ray', 20, 'يُرجى إزالة الأجسام المعدنية من منطقة الفحص.', 'Please remove metal objects from the study area.')
on conflict (code) do update set
  name_ar = excluded.name_ar,
  name_en = excluded.name_en,
  daily_capacity = excluded.daily_capacity,
  general_instruction_ar = excluded.general_instruction_ar,
  general_instruction_en = excluded.general_instruction_en,
  updated_at = now();

insert into exam_types (modality_id, name_ar, name_en, specific_instruction_ar, specific_instruction_en)
select modality.id, exam.name_ar, exam.name_en, exam.specific_instruction_ar, exam.specific_instruction_en
from modalities modality
join (
  values
    ('MRI', 'MRI Brain', 'رنين دماغ', 'اتبع تعليمات السلامة الخاصة بالرنين.', 'Follow MRI safety instructions.'),
    ('MRI', 'MRI Spine', 'رنين عمود فقري', 'إزالة المعادن قبل الفحص.', 'Remove metal objects before the study.'),
    ('CT', 'CT Brain', 'مقطعية دماغ', 'قد يلزم الصيام إذا وُجدت صبغة.', 'Fasting may be needed when contrast is requested.'),
    ('CT', 'CT Chest', 'مقطعية صدر', 'الالتزام بتعليمات الصبغة إن وُجدت.', 'Follow contrast instructions when needed.'),
    ('US', 'Ultrasound Abdomen', 'موجات فوق صوتية للبطن', 'صيام 6 ساعات إذا طُلب ذلك.', 'Fast for 6 hours if requested.'),
    ('US', 'Ultrasound Pelvis', 'موجات فوق صوتية للحوض', 'الحضور بمثانة ممتلئة عند الطلب.', 'Arrive with a full bladder when requested.'),
    ('XR', 'Chest X-Ray', 'أشعة صدر', 'إزالة المعادن من منطقة الصدر.', 'Remove metal items from the chest area.'),
    ('XR', 'Hand X-Ray', 'أشعة يد', 'إزالة أي خواتم أو معادن من اليد.', 'Remove rings or metal items from the hand.')
) as exam(modality_code, name_en, name_ar, specific_instruction_ar, specific_instruction_en)
  on exam.modality_code = modality.code
where not exists (
  select 1
  from exam_types existing
  where existing.modality_id = modality.id
    and lower(existing.name_en) = lower(exam.name_en)
);
