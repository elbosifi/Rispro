update system_settings
set setting_value = jsonb_build_object(
  'value',
  coalesce(system_settings.setting_value->'value', '{}'::jsonb) ||
  jsonb_build_object(
    'sonicDicomReadinessMode', 'sql_server',
    'sonicDicomSqlEnabled', false,
    'sonicDicomSqlServer', '',
    'sonicDicomSqlUsername', '',
    'sonicDicomSqlPassword', '',
    'sonicDicomSqlEncrypt', true,
    'sonicDicomSqlTrustServerCertificate', false,
    'sonicDicomSqlTimeoutMs', 8000,
    'sonicDicomDicomDatabaseName', 'dicom',
    'sonicDicomReportDatabaseName', 'report',
    'sonicDicomSqlFinalStatusCodes', jsonb_build_array(6),
    'sonicDicomSqlDraftStatusCodes', jsonb_build_array(1)
  )
)
where category = 'sonicdicom_reports'
  and setting_key = 'config';
