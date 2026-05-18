create table if not exists patient_not_allowed_name_words (
  id bigserial primary key,
  arabic_text text not null,
  normalized_arabic_text text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into patient_not_allowed_name_words (arabic_text, normalized_arabic_text, is_active)
values ('عبد', 'عبد', true)
on conflict (normalized_arabic_text)
do update set arabic_text = excluded.arabic_text, is_active = true, updated_at = now();
