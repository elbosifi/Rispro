alter table exam_types
add column if not exists code text;

alter table exam_types
add column if not exists duration_minutes integer;

with normalized as (
  select
    et.id,
    lower(
      trim(
        both '_' from regexp_replace(
          coalesce(nullif(et.name_en, ''), nullif(et.name_ar, ''), 'exam_type'),
          '[^A-Za-z0-9]+',
          '_',
          'g'
        )
      )
    ) as base_code,
    row_number() over (
      partition by et.modality_id,
      lower(
        trim(
          both '_' from regexp_replace(
            coalesce(nullif(et.name_en, ''), nullif(et.name_ar, ''), 'exam_type'),
            '[^A-Za-z0-9]+',
            '_',
            'g'
          )
        )
      )
      order by et.id
    ) as seq
  from exam_types et
  where et.code is null or btrim(et.code) = ''
),
resolved as (
  select
    id,
    case
      when coalesce(base_code, '') = '' then 'exam_type_' || id::text
      when seq = 1 then base_code
      else base_code || '_' || seq::text
    end as generated_code
  from normalized
)
update exam_types et
set code = resolved.generated_code
from resolved
where et.id = resolved.id;

alter table exam_types
alter column code set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'exam_types_modality_code_unique'
  ) then
    alter table exam_types
    add constraint exam_types_modality_code_unique unique (modality_id, code);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'exam_types_duration_minutes_check'
  ) then
    alter table exam_types
    add constraint exam_types_duration_minutes_check check (duration_minutes is null or duration_minutes >= 0);
  end if;
end $$;
