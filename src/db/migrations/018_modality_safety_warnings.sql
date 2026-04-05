-- Add safety warning columns to modalities table.
-- Allows per-modality safety messages in Arabic and English,
-- with an enable/disable toggle controlled from the settings UI.

alter table modalities add column if not exists safety_warning_ar text;
alter table modalities add column if not exists safety_warning_en text;
alter table modalities add column if not exists safety_warning_enabled boolean not null default true;

-- Pre-seed MRI modalities with a default safety warning
update modalities
set
  safety_warning_ar = 'قبل حجز فحص الرنين المغناطيسي، يرجى التأكد من خلو المريض من موانع الاستخدام: منظم ضربات القلب، الغرسات المعدنية، المشابك الجراحية، الحمل، والأجسام المعدنية الأجنبية.',
  safety_warning_en = 'Before booking an MRI appointment, you must ask the patient about MRI contraindications: pacemakers, metallic implants, surgical clips, pregnancy, and metallic foreign bodies.',
  safety_warning_enabled = true
where upper(name_en) like '%MRI%';
