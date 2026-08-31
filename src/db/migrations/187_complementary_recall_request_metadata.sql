alter table appointments_v2.complementary_recall_requests
  add column if not exists reason_code text,
  add column if not exists qa_classification text,
  add column if not exists urgency text,
  add column if not exists due_at timestamptz,
  add column if not exists reporting_disposition text;

alter table appointments_v2.complementary_recall_requests
  drop constraint if exists complementary_recall_requests_reason_code_check,
  drop constraint if exists complementary_recall_requests_qa_classification_check,
  drop constraint if exists complementary_recall_requests_urgency_check,
  drop constraint if exists complementary_recall_requests_reporting_disposition_check;

alter table appointments_v2.complementary_recall_requests
  add constraint complementary_recall_requests_reason_code_check
    check (reason_code is null or reason_code in ('missing_sequence_phase', 'incomplete_anatomical_coverage', 'motion_nondiagnostic_quality', 'incorrect_protocol', 'incorrect_contrast_phase_timing', 'additional_diagnostic_characterization', 'technical_equipment_problem', 'patient_related_limitation', 'other')),
  add constraint complementary_recall_requests_qa_classification_check
    check (qa_classification is null or qa_classification in ('diagnostic_addition', 'technical_repeat', 'protocol_error', 'acquisition_error', 'equipment_failure', 'patient_related_unavoidable', 'other')),
  add constraint complementary_recall_requests_urgency_check
    check (urgency is null or urgency in ('same_day', 'within_24_hours', 'within_72_hours', 'routine')),
  add constraint complementary_recall_requests_reporting_disposition_check
    check (reporting_disposition is null or reporting_disposition in ('supplement_original_report', 'separate_report', 'no_separate_report'));
