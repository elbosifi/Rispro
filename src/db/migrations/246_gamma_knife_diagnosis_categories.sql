update system_settings as settings
set setting_value = jsonb_set(
  settings.setting_value,
  '{diagnoses}',
  coalesce(settings.setting_value->'diagnoses', '[]'::jsonb) || coalesce((
    select jsonb_agg(jsonb_build_object('name', categories.name, 'checklist', '[]'::jsonb) order by categories.ordinal)
    from (values
      (1, 'Brain metastases'),
      (2, 'Vestibular schwannoma'),
      (3, 'Pituitary / parasellar lesion'),
      (4, 'Trigeminal neuralgia')
    ) as categories(ordinal, name)
    where not exists (
      select 1
      from jsonb_array_elements(coalesce(settings.setting_value->'diagnoses', '[]'::jsonb)) as existing(value)
      where lower(existing.value->>'name') = lower(categories.name)
    )
  ), '[]'::jsonb)
)
where settings.category='gamma_knife' and settings.setting_key='config';
