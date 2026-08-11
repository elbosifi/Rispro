create extension if not exists fuzzystrmatch;

create or replace function patient_english_name_dmetaphone_tokens(input_name text)
returns text[]
language sql
immutable
parallel safe
as $$
  select coalesce(
    array_agg(distinct phonetic.code order by phonetic.code)
      filter (where phonetic.code <> ''),
    array[]::text[]
  )
  from regexp_split_to_table(
    lower(regexp_replace(coalesce(input_name, ''), '\s+', ' ', 'g')),
    ' '
  ) as name_token(token)
  cross join lateral (
    values
      (dmetaphone(name_token.token)),
      (dmetaphone_alt(name_token.token))
  ) as phonetic(code)
  where name_token.token <> ''
$$;

create index if not exists idx_patients_english_name_dmetaphone_tokens
  on patients using gin (
    patient_english_name_dmetaphone_tokens(coalesce(english_full_name, ''))
  );
