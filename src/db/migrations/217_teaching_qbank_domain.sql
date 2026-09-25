create schema if not exists teaching;

create table if not exists teaching.specialties (
  id bigserial primary key,
  code text not null unique check (code ~ '^[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)*$'),
  label text not null check (length(btrim(label)) > 0),
  description text not null default '',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists teaching.domains (
  id bigserial primary key,
  specialty_id bigint not null references teaching.specialties(id) on delete restrict,
  code text not null check (code ~ '^[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)*$'),
  label text not null check (length(btrim(label)) > 0),
  description text not null default '',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (specialty_id, code),
  unique (id, specialty_id)
);

create table if not exists teaching.topics (
  id bigserial primary key,
  domain_id bigint not null references teaching.domains(id) on delete restrict,
  code text not null check (code ~ '^[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)*$'),
  label text not null check (length(btrim(label)) > 0),
  description text not null default '',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (domain_id, code),
  unique (id, domain_id)
);

create table if not exists teaching.subtopics (
  id bigserial primary key,
  topic_id bigint not null references teaching.topics(id) on delete restrict,
  code text not null check (code ~ '^[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)*$'),
  label text not null check (length(btrim(label)) > 0),
  description text not null default '',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (topic_id, code),
  unique (id, topic_id)
);

create table if not exists teaching.modalities (
  id bigserial primary key,
  code text not null unique check (code ~ '^[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)*$'),
  label text not null check (length(btrim(label)) > 0),
  description text not null default '',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists teaching.competencies (
  id bigserial primary key,
  code text not null unique check (code ~ '^[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)*$'),
  label text not null check (length(btrim(label)) > 0),
  description text not null default '',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists teaching.training_levels (
  id bigserial primary key,
  code text not null unique check (code ~ '^[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)*$'),
  label text not null check (length(btrim(label)) > 0),
  description text not null default '',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists teaching.difficulties (
  id bigserial primary key,
  value smallint not null unique check (value between 1 and 5),
  code text not null unique check (code ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
  label text not null check (length(btrim(label)) > 0),
  description text not null default '',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists teaching.tags (
  id bigserial primary key,
  code text not null unique check (code ~ '^[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)*$'),
  label text not null check (length(btrim(label)) > 0),
  description text not null default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists teaching.question_banks (
  id bigserial primary key,
  code text not null unique check (code ~ '^[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)*$'),
  name text not null check (length(btrim(name)) > 0),
  description text not null default '',
  specialty_id bigint not null references teaching.specialties(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, specialty_id)
);

create table if not exists teaching.cases (
  id bigserial primary key,
  external_id text not null unique check (external_id ~ '^[A-Z0-9]+(?:-[A-Z0-9]+)+$'),
  specialty_id bigint not null references teaching.specialties(id) on delete restrict,
  title text,
  clinical_history text,
  created_by_identity_issuer text not null,
  created_by_identity_subject text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (created_by_identity_issuer, created_by_identity_subject)
    references teaching.user_profiles(identity_issuer, identity_subject) on delete restrict,
  unique (id, specialty_id)
);

create table if not exists teaching.sources (
  id bigserial primary key,
  source_type text not null check (source_type in (
    'original', 'textbook', 'journal_article', 'guideline', 'society_document',
    'exam', 'question_bank', 'lecture', 'conference', 'website',
    'local_teaching', 'other', 'unknown'
  )),
  title text not null check (length(btrim(title)) > 0),
  organization text,
  authors text[] not null default array[]::text[],
  edition text,
  year smallint check (year is null or year between 1000 and 9999),
  chapter text,
  page text,
  exam_name text,
  exam_sitting text,
  exam_paper text,
  question_number text,
  url text,
  doi text,
  notes text,
  metadata_json jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata_json) = 'object'),
  is_active boolean not null default true,
  created_by_identity_issuer text not null,
  created_by_identity_subject text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (created_by_identity_issuer, created_by_identity_subject)
    references teaching.user_profiles(identity_issuer, identity_subject) on delete restrict
);

create table if not exists teaching."references" (
  id bigserial primary key,
  reference_type text not null check (reference_type in (
    'textbook', 'journal_article', 'guideline', 'society_document', 'website', 'other', 'unknown'
  )),
  title text not null check (length(btrim(title)) > 0),
  organization text,
  authors text[] not null default array[]::text[],
  year smallint check (year is null or year between 1000 and 9999),
  edition text,
  url text,
  doi text,
  citation_text text,
  notes text,
  created_by_identity_issuer text not null,
  created_by_identity_subject text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (created_by_identity_issuer, created_by_identity_subject)
    references teaching.user_profiles(identity_issuer, identity_subject) on delete restrict
);

create table if not exists teaching.assets (
  id bigserial primary key,
  asset_key text not null unique check (length(btrim(asset_key)) > 0),
  storage_key text not null unique check (length(btrim(storage_key)) > 0),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  original_filename text not null check (length(btrim(original_filename)) > 0),
  alt_text text not null default '',
  size_bytes bigint not null check (size_bytes >= 0),
  created_by_identity_issuer text not null,
  created_by_identity_subject text not null,
  created_at timestamptz not null default now(),
  foreign key (created_by_identity_issuer, created_by_identity_subject)
    references teaching.user_profiles(identity_issuer, identity_subject) on delete restrict
);

create table if not exists teaching.questions (
  id bigserial primary key,
  question_bank_id bigint not null references teaching.question_banks(id) on delete restrict,
  specialty_id bigint not null references teaching.specialties(id) on delete restrict,
  external_id text not null check (external_id ~ '^[A-Z0-9]+(?:-[A-Z0-9]+)+$'),
  created_by_identity_issuer text not null,
  created_by_identity_subject text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  retired_at timestamptz,
  retired_by_identity_issuer text,
  retired_by_identity_subject text,
  foreign key (created_by_identity_issuer, created_by_identity_subject)
    references teaching.user_profiles(identity_issuer, identity_subject) on delete restrict,
  foreign key (retired_by_identity_issuer, retired_by_identity_subject)
    references teaching.user_profiles(identity_issuer, identity_subject) on delete restrict,
  foreign key (question_bank_id, specialty_id)
    references teaching.question_banks(id, specialty_id) on delete restrict,
  unique (question_bank_id, external_id),
  unique (id, specialty_id),
  check ((retired_at is null) = (retired_by_identity_issuer is null)),
  check ((retired_by_identity_issuer is null) = (retired_by_identity_subject is null))
);

create table if not exists teaching.question_revisions (
  id bigserial primary key,
  question_id bigint not null references teaching.questions(id) on delete restrict,
  revision_number integer not null check (revision_number > 0),
  status text not null default 'draft' check (status in ('draft', 'in_review', 'published', 'retired')),
  question_type text not null check (question_type in ('single_best_answer', 'image_based_sba', 'case_based_sba')),
  stem text not null check (length(btrim(stem)) > 0),
  specialty_id bigint not null references teaching.specialties(id) on delete restrict,
  domain_id bigint not null,
  topic_id bigint,
  subtopic_id bigint,
  difficulty_id bigint not null references teaching.difficulties(id) on delete restrict,
  training_level_id bigint references teaching.training_levels(id) on delete restrict,
  case_id bigint,
  explanation_summary text not null default '',
  teaching_point text not null default '',
  further_discussion text,
  authorship_kind text not null default 'human_authored' check (authorship_kind in (
    'human_authored', 'ai_assisted', 'ai_generated', 'imported', 'unknown'
  )),
  model_name text,
  created_by_identity_issuer text not null,
  created_by_identity_subject text not null,
  created_at timestamptz not null default now(),
  updated_by_identity_issuer text,
  updated_by_identity_subject text,
  updated_at timestamptz not null default now(),
  submitted_by_identity_issuer text,
  submitted_by_identity_subject text,
  submitted_at timestamptz,
  reviewed_by_identity_issuer text,
  reviewed_by_identity_subject text,
  reviewed_at timestamptz,
  published_by_identity_issuer text,
  published_by_identity_subject text,
  published_at timestamptz,
  retired_by_identity_issuer text,
  retired_by_identity_subject text,
  retired_at timestamptz,
  foreign key (domain_id, specialty_id)
    references teaching.domains(id, specialty_id) on delete restrict,
  foreign key (question_id, specialty_id)
    references teaching.questions(id, specialty_id) on delete restrict,
  foreign key (topic_id, domain_id)
    references teaching.topics(id, domain_id) on delete restrict,
  foreign key (subtopic_id, topic_id)
    references teaching.subtopics(id, topic_id) on delete restrict,
  foreign key (case_id, specialty_id)
    references teaching.cases(id, specialty_id) on delete restrict,
  foreign key (created_by_identity_issuer, created_by_identity_subject)
    references teaching.user_profiles(identity_issuer, identity_subject) on delete restrict,
  foreign key (updated_by_identity_issuer, updated_by_identity_subject)
    references teaching.user_profiles(identity_issuer, identity_subject) on delete restrict,
  foreign key (submitted_by_identity_issuer, submitted_by_identity_subject)
    references teaching.user_profiles(identity_issuer, identity_subject) on delete restrict,
  foreign key (reviewed_by_identity_issuer, reviewed_by_identity_subject)
    references teaching.user_profiles(identity_issuer, identity_subject) on delete restrict,
  foreign key (published_by_identity_issuer, published_by_identity_subject)
    references teaching.user_profiles(identity_issuer, identity_subject) on delete restrict,
  foreign key (retired_by_identity_issuer, retired_by_identity_subject)
    references teaching.user_profiles(identity_issuer, identity_subject) on delete restrict,
  unique (question_id, revision_number),
  unique (id, question_id),
  check ((updated_by_identity_issuer is null) = (updated_by_identity_subject is null)),
  check ((submitted_by_identity_issuer is null) = (submitted_by_identity_subject is null)),
  check ((reviewed_by_identity_issuer is null) = (reviewed_by_identity_subject is null)),
  check ((published_by_identity_issuer is null) = (published_by_identity_subject is null)),
  check ((retired_by_identity_issuer is null) = (retired_by_identity_subject is null)),
  check ((submitted_at is null) = (submitted_by_identity_issuer is null)),
  check ((reviewed_at is null) = (reviewed_by_identity_issuer is null)),
  check ((published_at is null) = (published_by_identity_issuer is null)),
  check ((retired_at is null) = (retired_by_identity_issuer is null)),
  check (status <> 'in_review' or submitted_at is not null),
  check (status <> 'published' or (reviewed_at is not null and published_at is not null)),
  check (status <> 'retired' or retired_at is not null),
  check (question_type <> 'case_based_sba' or case_id is not null)
);

create table if not exists teaching.question_options (
  id bigserial primary key,
  question_revision_id bigint not null references teaching.question_revisions(id) on delete cascade,
  option_key text not null check (option_key ~ '^[A-Z]$'),
  text text not null check (length(btrim(text)) > 0),
  is_correct boolean not null default false,
  explanation text,
  sort_order smallint not null check (sort_order > 0),
  created_at timestamptz not null default now(),
  unique (question_revision_id, option_key),
  unique (question_revision_id, sort_order)
);
create unique index if not exists teaching_question_options_one_correct_idx
  on teaching.question_options(question_revision_id) where is_correct;

create table if not exists teaching.question_revision_modalities (
  question_revision_id bigint not null references teaching.question_revisions(id) on delete cascade,
  modality_id bigint not null references teaching.modalities(id) on delete restrict,
  sort_order smallint not null check (sort_order > 0),
  primary key (question_revision_id, modality_id),
  unique (question_revision_id, sort_order)
);

create table if not exists teaching.question_revision_competencies (
  question_revision_id bigint not null references teaching.question_revisions(id) on delete cascade,
  competency_id bigint not null references teaching.competencies(id) on delete restrict,
  sort_order smallint not null check (sort_order > 0),
  primary key (question_revision_id, competency_id),
  unique (question_revision_id, sort_order)
);

create table if not exists teaching.question_revision_tags (
  question_revision_id bigint not null references teaching.question_revisions(id) on delete cascade,
  tag_id bigint not null references teaching.tags(id) on delete restrict,
  sort_order smallint not null check (sort_order > 0),
  primary key (question_revision_id, tag_id),
  unique (question_revision_id, sort_order)
);

create table if not exists teaching.question_sources (
  question_revision_id bigint not null references teaching.question_revisions(id) on delete cascade,
  source_id bigint not null references teaching.sources(id) on delete restrict,
  relationship_to_source text not null check (relationship_to_source in (
    'original', 'adapted', 'paraphrased', 'verbatim', 'inspired_by', 'unknown'
  )),
  notes text,
  primary key (question_revision_id, source_id)
);

create table if not exists teaching.question_references (
  question_revision_id bigint not null references teaching.question_revisions(id) on delete cascade,
  reference_id bigint not null references teaching."references"(id) on delete restrict,
  sort_order smallint not null check (sort_order > 0),
  notes text,
  primary key (question_revision_id, reference_id),
  unique (question_revision_id, sort_order)
);

create table if not exists teaching.question_revision_assets (
  question_revision_id bigint not null references teaching.question_revisions(id) on delete cascade,
  asset_id bigint not null references teaching.assets(id) on delete restrict,
  sort_order smallint not null check (sort_order > 0),
  primary key (question_revision_id, asset_id),
  unique (question_revision_id, sort_order)
);

create table if not exists teaching.case_assets (
  case_id bigint not null references teaching.cases(id) on delete restrict,
  asset_id bigint not null references teaching.assets(id) on delete restrict,
  sort_order smallint not null check (sort_order > 0),
  primary key (case_id, asset_id),
  unique (case_id, sort_order)
);

create unique index if not exists teaching_question_revisions_one_open_idx
  on teaching.question_revisions(question_id) where status in ('draft', 'in_review');
create index if not exists teaching_question_revisions_status_created_idx
  on teaching.question_revisions(status, created_at desc, id desc);
create index if not exists teaching_question_revisions_classification_idx
  on teaching.question_revisions(specialty_id, domain_id, topic_id, subtopic_id);
create index if not exists teaching_questions_bank_updated_idx
  on teaching.questions(question_bank_id, updated_at desc, id desc) where retired_at is null;
create index if not exists teaching_cases_specialty_idx
  on teaching.cases(specialty_id, created_at desc, id desc);
create index if not exists teaching_question_sources_source_idx on teaching.question_sources(source_id);
create index if not exists teaching_question_references_reference_idx on teaching.question_references(reference_id);
create index if not exists teaching_question_revision_assets_asset_idx on teaching.question_revision_assets(asset_id);
create index if not exists teaching_case_assets_asset_idx on teaching.case_assets(asset_id);

insert into teaching.specialties (code, label, description, sort_order)
values ('radiology', 'Radiology', 'Radiology education and imaging interpretation.', 10)
on conflict (code) do nothing;

insert into teaching.domains (specialty_id, code, label, description, sort_order)
select specialty.id, seed.code, seed.label, seed.description, seed.sort_order
from teaching.specialties specialty
cross join (values
  ('neuroradiology', 'Neuroradiology', 'Imaging of the brain, spine, head, and neck.', 10),
  ('chest', 'Chest / Thoracic Imaging', 'Thoracic and cardiopulmonary imaging.', 20),
  ('cardiovascular', 'Cardiovascular Imaging', 'Imaging of the heart and vascular system.', 30),
  ('gastrointestinal', 'Gastrointestinal Imaging', 'Imaging of the gastrointestinal and hepatobiliary systems.', 40),
  ('genitourinary', 'Genitourinary Imaging', 'Imaging of the genitourinary system.', 50),
  ('musculoskeletal', 'Musculoskeletal Imaging', 'Imaging of bones, joints, and soft tissues.', 60),
  ('breast', 'Breast Imaging', 'Breast imaging and intervention.', 70),
  ('pediatric', 'Pediatric Radiology', 'Imaging of infants, children, and adolescents.', 80),
  ('nuclear_medicine', 'Nuclear Medicine', 'Molecular imaging and radionuclide studies.', 90),
  ('interventional_radiology', 'Interventional Radiology', 'Image-guided procedures and their imaging.', 100)
) as seed(code, label, description, sort_order)
where specialty.code = 'radiology'
on conflict (specialty_id, code) do nothing;

insert into teaching.topics (domain_id, code, label, description, sort_order)
select domain.id, seed.code, seed.label, seed.description, seed.sort_order
from teaching.domains domain
cross join (values
  ('brain-tumors', 'Brain Tumors', 'Primary and secondary intracranial neoplasms.', 10),
  ('stroke', 'Stroke', 'Cerebrovascular imaging and stroke patterns.', 20)
) as seed(code, label, description, sort_order)
where domain.code = 'neuroradiology'
on conflict (domain_id, code) do nothing;

insert into teaching.topics (domain_id, code, label, description, sort_order)
select domain.id, 'liver', 'Liver', 'Focal and diffuse liver disease.', 10
from teaching.domains domain
where domain.code = 'gastrointestinal'
on conflict (domain_id, code) do nothing;

insert into teaching.subtopics (topic_id, code, label, description, sort_order)
select topic.id, seed.code, seed.label, seed.description, seed.sort_order
from teaching.topics topic
cross join (values
  ('glioma', 'Glioma', 'Primary glial neoplasms.', 10),
  ('brain-metastases', 'Brain Metastases', 'Secondary intracranial neoplasms.', 20)
) as seed(code, label, description, sort_order)
where topic.code = 'brain-tumors'
on conflict (topic_id, code) do nothing;

insert into teaching.subtopics (topic_id, code, label, description, sort_order)
select topic.id, 'hepatocellular-carcinoma', 'Hepatocellular Carcinoma', 'Imaging and assessment of hepatocellular carcinoma.', 10
from teaching.topics topic
where topic.code = 'liver'
on conflict (topic_id, code) do nothing;

insert into teaching.modalities (code, label, description, sort_order)
values
  ('radiography', 'Radiography', '', 10),
  ('CT', 'CT', '', 20),
  ('MRI', 'MRI', '', 30),
  ('ultrasound', 'Ultrasound', '', 40),
  ('mammography', 'Mammography', '', 50),
  ('fluoroscopy', 'Fluoroscopy', '', 60),
  ('angiography', 'Angiography', '', 70),
  ('PET_CT', 'PET/CT', '', 80),
  ('nuclear_medicine', 'Nuclear Medicine', '', 90)
on conflict (code) do nothing;

insert into teaching.competencies (code, label, description, sort_order)
values
  ('anatomy', 'Anatomy', 'Identify normal structures and their relationships on imaging.', 10),
  ('diagnosis', 'Diagnosis', 'Select the most likely diagnosis from the clinical and imaging information.', 20),
  ('imaging_findings', 'Imaging Findings', 'Recognize and describe relevant imaging findings.', 30),
  ('differential_diagnosis', 'Differential Diagnosis', 'Compare plausible diagnoses using discriminating evidence.', 40),
  ('staging', 'Staging', 'Assess disease extent using an established staging system.', 50),
  ('response_assessment', 'Response Assessment', 'Evaluate change after treatment using accepted response criteria.', 60),
  ('management', 'Management', 'Choose an appropriate next step in patient management.', 70),
  ('appropriateness', 'Appropriateness', 'Assess the appropriateness of an imaging examination.', 80),
  ('procedure', 'Procedure', 'Apply knowledge of image-guided procedures and technique.', 90),
  ('safety', 'Safety', 'Apply imaging and procedural safety principles.', 100),
  ('physics', 'Physics', 'Apply imaging physics concepts to image formation and quality.', 110)
on conflict (code) do nothing;

insert into teaching.training_levels (code, label, description, sort_order)
values
  ('foundation', 'Foundation', 'Foundational knowledge and image-recognition skills.', 10),
  ('junior_resident', 'Junior Resident', 'Early residency-level knowledge and supervised interpretation.', 20),
  ('intermediate_resident', 'Intermediate Resident', 'Developing independent interpretation and clinical integration.', 30),
  ('senior_resident', 'Senior Resident', 'Advanced interpretation, synthesis, and decision-making.', 40)
on conflict (code) do nothing;

insert into teaching.difficulties (value, code, label, description, sort_order)
values
  (1, 'very_easy', 'Very Easy', 'Requires recognition of a common, straightforward concept.', 10),
  (2, 'easy', 'Easy', 'Requires one basic interpretation or reasoning step.', 20),
  (3, 'moderate', 'Moderate', 'Requires integration of several relevant findings.', 30),
  (4, 'difficult', 'Difficult', 'Requires nuanced interpretation or multi-step reasoning.', 40),
  (5, 'very_difficult', 'Very Difficult', 'Requires advanced synthesis of complex or ambiguous information.', 50)
on conflict (value) do nothing;

insert into teaching.tags (code, label, description)
values
  ('oncology', 'Oncology', ''),
  ('emergency', 'Emergency', ''),
  ('RECIST_1_1', 'RECIST 1.1', ''),
  ('RANO', 'RANO', ''),
  ('LI_RADS', 'LI-RADS', ''),
  ('PI_RADS', 'PI-RADS', ''),
  ('BI_RADS', 'BI-RADS', ''),
  ('O_RADS', 'O-RADS', ''),
  ('TNM', 'TNM', ''),
  ('MRI_safety', 'MRI Safety', ''),
  ('contrast_safety', 'Contrast Safety', ''),
  ('radiation_safety', 'Radiation Safety', '')
on conflict (code) do nothing;

insert into teaching.question_banks (code, name, description, specialty_id)
select 'radiology-main', 'RISpro Radiology Question Bank', 'Main Radiology teaching question bank.', specialty.id
from teaching.specialties specialty
where specialty.code = 'radiology'
on conflict (code) do nothing;
