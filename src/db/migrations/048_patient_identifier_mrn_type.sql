-- Add MRN as a first-class identifier type for patients created without external ID.
-- When a patient is registered without a national ID, passport, or other identifier,
-- the generated MRN becomes their primary identifier in patient_identifiers.
insert into patient_identifier_types (code, label_ar, label_en, is_active)
values ('mrn', 'رقم الملف', 'MRN', true)
on conflict (code) do nothing;