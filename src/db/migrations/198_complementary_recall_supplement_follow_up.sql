alter table appointments_v2.complementary_recall_requests
  add column if not exists supplement_follow_up_acknowledged_at timestamptz null;

create index if not exists complementary_recall_requests_supplement_follow_up_idx
  on appointments_v2.complementary_recall_requests(original_appointment_id, completed_at)
  where reporting_disposition = 'supplement_original_report'
    and supplement_follow_up_acknowledged_at is null;

insert into email_notification_rules (event_type, enabled, subject_template, text_body_template)
values ('additional_imaging_report_finalized', false, 'RISpro: Additional imaging report finalized — {{additional_imaging_accession}}', E'The additional-imaging report is final and the original report dependency is resolved.\n\nPatient: {{patient_name}}\nOriginal examination: {{original_examination}}\nAdditional imaging accession: {{additional_imaging_accession}}\n\nRISpro')
on conflict (event_type) do nothing;
