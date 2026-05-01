update system_settings
set setting_value = jsonb_build_object(
  'value',
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          coalesce(setting_value->'value', '{}'::jsonb),
          '{reportAccessModalityMode}',
          to_jsonb(
            case
              when coalesce(setting_value->'value'->>'reportAccessModalityMode', '') in ('all', 'include', 'exclude')
                then setting_value->'value'->>'reportAccessModalityMode'
              else 'all'
            end
          ),
          true
        ),
        '{reportAccessModalityIds}',
        case
          when jsonb_typeof(setting_value->'value'->'reportAccessModalityIds') = 'array'
            then setting_value->'value'->'reportAccessModalityIds'
          else '[]'::jsonb
        end,
        true
      ),
      '{imageAccessModalityMode}',
      to_jsonb(
        case
          when coalesce(setting_value->'value'->>'imageAccessModalityMode', '') in ('all', 'include', 'exclude')
            then setting_value->'value'->>'imageAccessModalityMode'
          else 'all'
        end
      ),
      true
    ),
    '{imageAccessModalityIds}',
    case
      when jsonb_typeof(setting_value->'value'->'imageAccessModalityIds') = 'array'
        then setting_value->'value'->'imageAccessModalityIds'
      else '[]'::jsonb
    end,
    true
  )
)
where category = 'patient_qr_self_service'
  and setting_key = 'config';
