alter table patients
  add column if not exists normalized_arabic_name_compact text;

update patients
set normalized_arabic_name_compact = regexp_replace(
  translate(
    regexp_replace(coalesce(normalized_arabic_name, arabic_full_name, ''), '[ـً-ٰٟ\s]+', '', 'g'),
    'أإآةىؤئ',
    'اااهيوي'
  ),
  '\s+',
  '',
  'g'
)
where normalized_arabic_name_compact is null;

create index if not exists idx_patients_normalized_arabic_name_compact
  on patients (normalized_arabic_name_compact);
