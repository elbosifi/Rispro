create extension if not exists pg_trgm;
create extension if not exists fuzzystrmatch;

create index if not exists idx_patients_normalized_arabic_name_trgm
  on patients using gin (normalized_arabic_name gin_trgm_ops);

create index if not exists idx_patients_normalized_english_name_trgm
  on patients using gin ((lower(regexp_replace(coalesce(english_full_name, ''), '\s+', ' ', 'g'))) gin_trgm_ops);
