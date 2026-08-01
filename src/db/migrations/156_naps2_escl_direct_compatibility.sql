-- Direct browser-to-NAPS2 eSCL is the primary scanner path. Keep legacy bridge
-- settings for rollback, but only promote values that are already eSCL endpoints.
update system_settings as direct
set setting_value = legacy.setting_value
from system_settings as legacy
where direct.category = 'documents_and_uploads'
  and direct.setting_key = 'naps2_webscan_endpoint'
  and coalesce(direct.setting_value ->> 'value', '') = ''
  and legacy.category = 'documents_and_uploads'
  and legacy.setting_key = 'scanner_bridge_endpoint'
  and coalesce(legacy.setting_value ->> 'value', '') ~* '^https?://[^/:]+:98(0[1-9]|[1-4][0-9]|50)(/|$)';
