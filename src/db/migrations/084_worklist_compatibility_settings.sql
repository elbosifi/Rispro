insert into system_settings (category, setting_key, setting_value)
values
  ('orthanc_mwl_sync', 'mwl_specific_character_set', '{"value":"ISO_IR 192"}'::jsonb),
  ('orthanc_mwl_sync', 'mwl_patient_id_source', '{"value":"identifier_value"}'::jsonb),
  ('orthanc_mwl_sync', 'mwl_patient_name_source', '{"value":"english_full_name"}'::jsonb),
  ('orthanc_mwl_sync', 'mwl_procedure_description_source', '{"value":"exam_name_en"}'::jsonb),
  ('orthanc_mwl_sync', 'mwl_enabled_tags_json', '{"value":"{}"}'::jsonb),
  ('orthanc_mwl_sync', 'mwl_tag_limits_json', '{"value":"{}"}'::jsonb),
  ('orthanc_mwl_sync', 'mwl_overflow_policy_json', '{"value":"{}"}'::jsonb),
  ('orthanc_mwl_sync', 'mwl_extra_tags_json', '{"value":"[]"}'::jsonb),
  ('sante_worklist_hl7', 'hl7_enabled_fields_json', '{"value":"{}"}'::jsonb),
  ('sante_worklist_hl7', 'hl7_field_limits_json', '{"value":"{}"}'::jsonb),
  ('sante_worklist_hl7', 'hl7_overflow_policy_json', '{"value":"{}"}'::jsonb),
  ('sante_worklist_hl7', 'hl7_extra_fields_json', '{"value":"[]"}'::jsonb)
on conflict (category, setting_key) do nothing;
