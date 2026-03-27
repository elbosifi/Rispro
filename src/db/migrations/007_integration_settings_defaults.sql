insert into system_settings (category, setting_key, setting_value)
values
  ('printing_and_labels', 'slip_printer_profile', '{"value":"browser_default"}'::jsonb),
  ('printing_and_labels', 'label_output_mode', '{"value":"browser_print"}'::jsonb),
  ('printing_and_labels', 'direct_print_bridge_mode', '{"value":"disabled"}'::jsonb),
  ('documents_and_uploads', 'scanner_profile_name', '{"value":"default_twain_profile"}'::jsonb),
  ('documents_and_uploads', 'scanner_source', '{"value":"feeder"}'::jsonb),
  ('documents_and_uploads', 'scan_dpi', '{"value":"300"}'::jsonb),
  ('documents_and_uploads', 'scan_color_mode', '{"value":"grayscale"}'::jsonb),
  ('documents_and_uploads', 'scan_file_format', '{"value":"pdf"}'::jsonb)
on conflict (category, setting_key) do nothing;
