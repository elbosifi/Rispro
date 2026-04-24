-- Patient QR report access and SonicDICOM report integration defaults.

alter table appointments_v2.bookings
  add column if not exists requires_report boolean not null default false,
  add column if not exists study_instance_uid text;

insert into system_settings (category, setting_key, setting_value)
values (
  'patient_qr_self_service',
  'config',
  '{
    "value": {
      "enabled": true,
      "printQrOnAppointmentSlip": true,
      "allowCancellation": true,
      "allowAddToCalendar": true,
      "showBookingTime": true,
      "showPreparationInstructions": true,
      "showDocumentsChecklist": true,
      "showDepartmentContact": false,
      "showLocationDirections": false,
      "allowReportAccess": false,
      "showReportPendingCard": true,
      "reportAccessRequiresCompletedAppointment": true,
      "showReportNotRequiredMessage": false,
      "defaultReportRequiredForOncology": true,
      "defaultReportRequiredForNonOncology": false,
      "qrReportCheckingMessage": "Checking report status...",
      "qrReportFinalMessage": "Your report is ready.",
      "qrReportDraftMessage": "Your report is still under review and is not finalized yet.",
      "qrReportNoReportMessage": "No report is available for this appointment yet.",
      "qrReportUnavailableMessage": "The report system is temporarily unavailable. Please try again later.",
      "qrReportNotRequiredMessage": "",
      "qrReportNotCompletedMessage": "Report access becomes available after the examination is completed.",
      "qrReportCheckButtonLabel": "Check report",
      "qrReportViewButtonLabel": "View report"
    }
  }'::jsonb
)
on conflict (category, setting_key) do update
set setting_value = jsonb_build_object(
  'value',
  coalesce(system_settings.setting_value->'value', '{}'::jsonb) ||
  '{
    "allowReportAccess": false,
    "showReportPendingCard": true,
    "reportAccessRequiresCompletedAppointment": true,
    "showReportNotRequiredMessage": false,
    "defaultReportRequiredForOncology": true,
    "defaultReportRequiredForNonOncology": false,
    "qrReportCheckingMessage": "Checking report status...",
    "qrReportFinalMessage": "Your report is ready.",
    "qrReportDraftMessage": "Your report is still under review and is not finalized yet.",
    "qrReportNoReportMessage": "No report is available for this appointment yet.",
    "qrReportUnavailableMessage": "The report system is temporarily unavailable. Please try again later.",
    "qrReportNotRequiredMessage": "",
    "qrReportNotCompletedMessage": "Report access becomes available after the examination is completed.",
    "qrReportCheckButtonLabel": "Check report",
    "qrReportViewButtonLabel": "View report"
  }'::jsonb
)
where system_settings.category = 'patient_qr_self_service'
  and system_settings.setting_key = 'config';

insert into system_settings (category, setting_key, setting_value)
values (
  'sonicdicom_reports',
  'config',
  '{
    "value": {
      "sonicDicomReportsEnabled": false,
      "sonicDicomPublicBaseUrl": "https://ris.nccb.com.ly/viewer",
      "sonicDicomPublicReportViewerUrlTemplate": "{{publicBaseUrl}}/#/report?id={{username}}&password={{password}}&accessionnumber={{accessionNumber}}&pdf=true",
      "sonicDicomPublicPdfUrlTemplate": "{{publicBaseUrl}}/#/report?id={{username}}&password={{password}}&accessionnumber={{accessionNumber}}&pdf=true",
      "sonicDicomInternalBaseUrl": "",
      "sonicDicomInternalSearchUrlTemplate": "",
      "sonicDicomInternalReportViewerUrlTemplate": "{{internalBaseUrl}}/#/report?id={{username}}&password={{password}}&accessionnumber={{accessionNumber}}&pdf=true",
      "sonicDicomInternalPdfUrlTemplate": "{{internalBaseUrl}}/#/report?id={{username}}&password={{password}}&accessionnumber={{accessionNumber}}&pdf=true",
      "sonicDicomReportViewerUsername": "patient",
      "sonicDicomReportViewerPassword": "patient",
      "sonicDicomReportLookupKey": "accession_number",
      "sonicDicomSearchMode": "auto",
      "sonicDicomFinalStatusTerms": ["Final", "Signed", "Approved"],
      "sonicDicomDraftStatusTerms": ["Draft", "Preliminary", "In review", "Unsigned"],
      "sonicDicomNoReportStatusTerms": ["No report", "Not found", "Empty", "No matching report"],
      "sonicDicomUnavailableStatusTerms": ["Unavailable", "Timeout", "Login failed"],
      "sonicDicomTimeoutMs": 8000,
      "sonicDicomStatusCacheTtlSeconds": 60,
      "sonicDicomVerifyTls": true,
      "allowPublicFallbackForStatusCheck": false,
      "auditPatientReportAccess": true,
      "auditReportStatusChecks": true
    }
  }'::jsonb
)
on conflict (category, setting_key) do nothing;
