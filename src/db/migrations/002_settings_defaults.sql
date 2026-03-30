insert into system_settings (category, setting_key, setting_value)
values
  ('general_system', 'site_name', '{"value":"RISpro Reception"}'::jsonb),
  ('general_system', 'default_route_after_login', '{"value":"dashboard"}'::jsonb),
  ('general_system', 'business_day_start', '{"value":"07:00"}'::jsonb),
  ('general_system', 'time_zone', '{"value":"Africa/Tripoli"}'::jsonb),

  ('users_and_roles', 'roles_enabled', '{"value":"supervisor,receptionist"}'::jsonb),
  ('users_and_roles', 'allow_user_creation', '{"value":"enabled"}'::jsonb),
  ('users_and_roles', 'overbooking_permission', '{"value":"supervisor_only"}'::jsonb),
  ('users_and_roles', 'duplicate_merge_permission', '{"value":"all_users_with_confirmation"}'::jsonb),

  ('security_and_access', 'settings_reauth', '{"value":"enabled"}'::jsonb),
  ('security_and_access', 'password_policy', '{"value":"strong"}'::jsonb),
  ('security_and_access', 'session_timeout_minutes', '{"value":"30"}'::jsonb),
  ('security_and_access', 'login_audit_log', '{"value":"enabled"}'::jsonb),

  ('language_and_interface', 'default_language', '{"value":"ar"}'::jsonb),
  ('language_and_interface', 'language_switcher', '{"value":"enabled"}'::jsonb),
  ('language_and_interface', 'arabic_direction', '{"value":"rtl"}'::jsonb),
  ('language_and_interface', 'english_direction', '{"value":"ltr"}'::jsonb),

  ('patient_registration', 'phone1_required', '{"value":"required"}'::jsonb),
  ('patient_registration', 'dob_or_age_rule', '{"value":"age_or_dob_required"}'::jsonb),
  ('patient_registration', 'national_id_required', '{"value":"optional"}'::jsonb),
  ('patient_registration', 'custom_fields_scope', '{"value":"all_patients"}'::jsonb),

  ('transliteration_and_dictionary', 'live_transliteration', '{"value":"enabled"}'::jsonb),
  ('transliteration_and_dictionary', 'dictionary_priority', '{"value":"before_general_rules"}'::jsonb),
  ('transliteration_and_dictionary', 'manual_english_edit', '{"value":"enabled"}'::jsonb),
  ('transliteration_and_dictionary', 'arabic_variant_matching', '{"value":"enabled"}'::jsonb),

  ('modalities_and_exams', 'modalities_enabled', '{"value":"MRI,CT,US,XR"}'::jsonb),
  ('modalities_and_exams', 'add_exam_from_appointment', '{"value":"enabled"}'::jsonb),
  ('modalities_and_exams', 'modality_instructions', '{"value":"enabled"}'::jsonb),
  ('modalities_and_exams', 'exam_specific_instructions', '{"value":"enabled"}'::jsonb),

  ('scheduling_and_capacity', 'capacity_mode', '{"value":"per_modality_per_day"}'::jsonb),
  ('scheduling_and_capacity', 'calendar_window_days', '{"value":"14"}'::jsonb),
  ('scheduling_and_capacity', 'double_booking_prevention', '{"value":"enabled"}'::jsonb),
  ('scheduling_and_capacity', 'overbooking_reason_required', '{"value":"enabled"}'::jsonb),
  ('scheduling_and_capacity', 'allow_friday_appointments', '{"value":"enabled"}'::jsonb),
  ('scheduling_and_capacity', 'allow_saturday_appointments', '{"value":"enabled"}'::jsonb),

  ('queue_and_arrival', 'barcode_check_in', '{"value":"enabled"}'::jsonb),
  ('queue_and_arrival', 'walk_in_queue', '{"value":"enabled"}'::jsonb),
  ('queue_and_arrival', 'no_show_review_time', '{"value":"17:00"}'::jsonb),
  ('queue_and_arrival', 'no_show_confirmation_required', '{"value":"enabled"}'::jsonb),

  ('printing_and_labels', 'appointment_slip', '{"value":"enabled"}'::jsonb),
  ('printing_and_labels', 'patient_label', '{"value":"enabled"}'::jsonb),
  ('printing_and_labels', 'barcode_value_source', '{"value":"accession_number"}'::jsonb),
  ('printing_and_labels', 'label_printer_profile', '{"value":"customize_later"}'::jsonb),

  ('documents_and_uploads', 'referral_upload', '{"value":"enabled"}'::jsonb),
  ('documents_and_uploads', 'allowed_file_types', '{"value":"pdf,jpg,png"}'::jsonb),
  ('documents_and_uploads', 'document_link_scope', '{"value":"patient_and_appointment"}'::jsonb),
  ('documents_and_uploads', 'scanner_bridge_mode', '{"value":"future_local_bridge"}'::jsonb),

  ('dashboard_and_ui', 'dashboard_cards', '{"value":"enabled"}'::jsonb),
  ('dashboard_and_ui', 'status_color_coding', '{"value":"enabled"}'::jsonb),
  ('dashboard_and_ui', 'quick_actions', '{"value":"enabled"}'::jsonb),
  ('dashboard_and_ui', 'capacity_board', '{"value":"enabled"}'::jsonb),

  ('audit_and_logging', 'audit_trail', '{"value":"enabled"}'::jsonb),
  ('audit_and_logging', 'store_old_new_values', '{"value":"enabled"}'::jsonb),
  ('audit_and_logging', 'store_no_show_reason', '{"value":"enabled"}'::jsonb),
  ('audit_and_logging', 'store_cancel_reason', '{"value":"enabled"}'::jsonb),

  ('backup_and_restore', 'allow_backup_download', '{"value":"enabled"}'::jsonb),
  ('backup_and_restore', 'allow_restore_upload', '{"value":"enabled"}'::jsonb),
  ('backup_and_restore', 'backup_target', '{"value":"local_file_or_browser_download"}'::jsonb),
  ('backup_and_restore', 'restore_permission', '{"value":"supervisor_only"}'::jsonb)
on conflict (category, setting_key) do nothing;
