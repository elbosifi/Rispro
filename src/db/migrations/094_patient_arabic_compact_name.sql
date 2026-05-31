create extension if not exists pg_trgm;

alter table patients
  add column if not exists normalized_arabic_name_compact text;

update patients
set normalized_arabic_name_compact = regexp_replace(
  translate(
    regexp_replace(coalesce(arabic_full_name, ''), '[ـً-ٰٟ\s]+', '', 'g'),
    'أإآةىؤئ',
    'اااهيوي'
  ),
  '\s+',
  '',
  'g'
)
where normalized_arabic_name_compact is null;

create index if not exists idx_patients_normalized_arabic_name_compact
  on patients (normalized_arabic_name_compact text_pattern_ops);

create index if not exists idx_patients_normalized_arabic_name_compact_trgm
  on patients using gin (normalized_arabic_name_compact gin_trgm_ops);
