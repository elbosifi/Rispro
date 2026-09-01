alter table email_notification_rules
  add column if not exists subject_template text,
  add column if not exists text_body_template text;

update email_notification_rules
set subject_template = 'RISpro: Additional imaging completed — {{additional_imaging_accession}}',
    text_body_template = E'Additional imaging has been completed and is ready for review.\n\nPatient: {{patient_name}}\nOriginal examination: {{original_examination}}\nModality: {{modality}}\nOriginal accession: {{original_accession}}\nAdditional imaging accession: {{additional_imaging_accession}}\nReporting action: {{reporting_action}}\n\nPlease review the additional images and complete the appropriate reporting action.\n\nRISpro'
where event_type = 'additional_imaging_completed' and (subject_template is null or text_body_template is null);

alter table email_notification_rules alter column subject_template set not null, alter column text_body_template set not null;
