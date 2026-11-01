-- Preserve legacy settings as migration evidence. Appointment-slip identity has
-- precedence over QR center names; non-empty QR values fill missing names.
-- The established public URL and HTTPS settings retain their existing keys.
with legacy as (
  select
    coalesce((select coalesce(setting_value->'value',setting_value) from system_settings where category='appointment_slip' and setting_key='config'), '{}'::jsonb) slip,
    coalesce((select coalesce(setting_value->'value',setting_value) from system_settings where category='patient_qr_self_service' and setting_key='config'), '{}'::jsonb) qr
)
insert into system_settings(category,setting_key,setting_value)
select 'deployment_identity','institution',jsonb_build_object('value',jsonb_build_object(
  'hospitalNameEn',coalesce(nullif(slip->>'hospitalNameEn',''),nullif(qr#>>'{location,centerNameEn}',''),'National Cancer Center Benghazi'),
  'hospitalNameAr',coalesce(nullif(slip->>'hospitalNameAr',''),nullif(qr#>>'{location,centerNameAr}',''),'المركز الوطني للأورام بنغازي'),
  'departmentNameEn',coalesce(slip->>'departmentNameEn','Diagnostic Radiology Department'),
  'departmentNameAr',coalesce(slip->>'departmentNameAr','قسم الأشعة التشخيصية'),
  'addressEn',coalesce(qr#>>'{location,addressEn}',''), 'addressAr',coalesce(qr#>>'{location,addressAr}',''),
  'primaryPhone',coalesce(qr#>>'{contact,primaryPhone}',''), 'secondaryPhone',coalesce(qr#>>'{contact,secondaryPhone}',''),
  'contactInformation','', 'website','', 'hospitalLogo','/assets/nccb-logo.png', 'departmentLogo',''
)) from legacy on conflict(category,setting_key) do nothing;

-- No updates to finalized reports or append-only versions. Their original lack
-- of a recorded institution remains explicit; future signatures capture it.
