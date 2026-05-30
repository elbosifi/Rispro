insert into system_settings (category, setting_key, setting_value)
select
  'queue_and_arrival',
  'auto_no_show_enabled',
  case
    when lower(coalesce(manual_confirmation.setting_value->>'value', 'enabled')) in ('disabled', 'off', 'false', 'no', '0')
      then '{"value":"enabled"}'::jsonb
    else '{"value":"disabled"}'::jsonb
  end
from (select 1) seed
left join system_settings manual_confirmation
  on manual_confirmation.category = 'queue_and_arrival'
 and manual_confirmation.setting_key = 'no_show_confirmation_required'
on conflict (category, setting_key) do nothing;
