update system_settings
set setting_value = jsonb_build_object('value', 'patients')
where category = 'general_system'
  and setting_key = 'default_route_after_login';
