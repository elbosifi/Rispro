update system_settings
set setting_value = jsonb_build_object(
  'value',
  coalesce(system_settings.setting_value->'value', '{}'::jsonb) ||
  jsonb_build_object(
    'allowImageAccess', false,
    'imageAccessRequiresCompletedAppointment', true,
    'imageAccessRequiresReportRequiredFlag', false,
    'qrImageViewButtonLabel', 'View images',
    'qrImageUnavailableMessage', 'Image viewing is currently unavailable. Please try again later.',
    'qrReportStudyNotFoundMessage', 'Your study is not available in the report system yet. Please try again later.',
    'qrImageStudyNotFoundMessage', 'Your study images are not available yet. Please try again later.'
  )
)
where category = 'patient_qr_self_service'
  and setting_key = 'config';

update system_settings
set setting_value = jsonb_build_object(
  'value',
  coalesce(system_settings.setting_value->'value', '{}'::jsonb) ||
  jsonb_build_object(
    'sonicDicomPublicImageViewerUrlTemplate', '{{publicBaseUrl}}/#/viewer?id={{username}}&password={{password}}&accessionnumber={{accessionNumber}}'
  )
)
where category = 'sonicdicom_reports'
  and setting_key = 'config';
