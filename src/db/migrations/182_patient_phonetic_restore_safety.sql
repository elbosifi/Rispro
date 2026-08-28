-- Make the patient phonetic helper safe under restricted search_path
-- environments such as pg_dump/pg_restore.
--
-- fuzzystrmatch is installed in the public schema, so explicitly qualify
-- dmetaphone() and dmetaphone_alt() rather than relying on search_path.

create extension if not exists fuzzystrmatch;

create or replace function public.patient_english_name_dmetaphone_tokens(input_name text)
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
      (public.dmetaphone(name_token.token)),
      (public.dmetaphone_alt(name_token.token))
  ) as phonetic(code)
  where name_token.token <> ''
$$;

create index if not exists idx_patients_english_name_dmetaphone_tokens
  on public.patients using gin (
    public.patient_english_name_dmetaphone_tokens(
      coalesce(english_full_name, '')
    )
  );
