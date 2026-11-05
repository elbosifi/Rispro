create table gamma_knife_treatment_courses (
  id bigserial primary key,
  episode_id bigint not null references gamma_knife_episodes(id),
  course_number integer not null check (course_number > 0),
  prior_course_id bigint references gamma_knife_treatment_courses(id),
  immobilization text not null check (immobilization in ('frame','mask')),
  planned_fraction_count integer not null check (planned_fraction_count between 1 and 100),
  gamma_plan_reference text,
  target_references jsonb not null default '[]'::jsonb check (jsonb_typeof(target_references) = 'array'),
  status text not null check (status in ('planned','in_progress','interrupted','completed','cancelled')),
  source text not null default 'clinical_record' check (source in ('clinical_record','legacy_import')),
  legacy_treatment_snapshot jsonb,
  completion_confirmed boolean not null default false,
  completion_reason text,
  completed_at date,
  completed_by bigint references users(id),
  report_document_id bigint references documents(id),
  documentation_finalized boolean not null default false,
  booking_id bigint,
  created_by bigint references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (episode_id, course_number),
  check ((status = 'completed') = completion_confirmed),
  check (status <> 'completed' or (completed_at is not null and length(trim(coalesce(completion_reason,''))) > 0
    and ((source = 'legacy_import' and completed_by is null) or (source = 'clinical_record' and completed_by is not null)))),
  check (source <> 'legacy_import' or legacy_treatment_snapshot is not null)
);

create unique index gamma_knife_one_open_treatment_course
  on gamma_knife_treatment_courses(episode_id)
  where status in ('planned','in_progress','interrupted');

create table gamma_knife_reassessments (
  id bigserial primary key,
  episode_id bigint not null references gamma_knife_episodes(id),
  course_id bigint not null references gamma_knife_treatment_courses(id),
  reason text not null check (reason in ('progression','complication','uncertain_response','other')),
  reason_detail text not null check (length(trim(reason_detail)) > 0),
  status text not null default 'requested' check (status in ('requested','awaiting_information','decided','cancelled')),
  revision integer not null default 1,
  requested_by bigint not null references users(id),
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index gamma_knife_one_open_course_reassessment
  on gamma_knife_reassessments(course_id) where status in ('requested','awaiting_information');

alter table gamma_knife_treatment_courses
  add column reassessment_id bigint references gamma_knife_reassessments(id);
create unique index gamma_knife_one_course_per_reassessment
  on gamma_knife_treatment_courses(reassessment_id) where reassessment_id is not null;

create table gamma_knife_reassessment_decisions (
  id bigserial primary key,
  reassessment_id bigint not null references gamma_knife_reassessments(id),
  revision integer not null check (revision > 0),
  decision text not null check (decision in ('approved','additional_information','deferred','not_suitable')),
  assessment text not null,
  notes text not null default '',
  consultants text[] not null check (cardinality(consultants) > 0),
  reason text not null default '',
  assessment_revision integer,
  actor_id bigint not null references users(id),
  created_at timestamptz not null default now(),
  unique (reassessment_id, revision)
);

create table gamma_knife_treatment_fractions (
  id bigserial primary key,
  course_id bigint not null references gamma_knife_treatment_courses(id),
  planned_fraction_number integer not null check (planned_fraction_number between 1 and 100),
  status text not null check (status in ('delivered','interrupted','not_delivered')),
  event_date date not null,
  operator_name text not null check (length(trim(operator_name)) > 0),
  operator_id bigint references users(id),
  gamma_plan_reference text,
  notes text not null default '',
  created_by bigint not null references users(id),
  created_at timestamptz not null default now(),
  check (status <> 'delivered' or length(trim(coalesce(gamma_plan_reference,''))) > 0)
);

create unique index gamma_knife_one_delivered_record_per_fraction
  on gamma_knife_treatment_fractions(course_id, planned_fraction_number)
  where status = 'delivered';

create table gamma_knife_treatment_history (
  id bigserial primary key,
  course_id bigint not null references gamma_knife_treatment_courses(id),
  fraction_id bigint references gamma_knife_treatment_fractions(id),
  action text not null,
  reason text not null default '',
  snapshot jsonb not null,
  actor_id bigint not null references users(id),
  created_at timestamptz not null default now()
);

create table gamma_knife_reassessment_history (
  id bigserial primary key,
  reassessment_id bigint not null references gamma_knife_reassessments(id),
  action text not null,
  reason text not null default '',
  snapshot jsonb not null,
  actor_id bigint not null references users(id),
  created_at timestamptz not null default now()
);

create table gamma_knife_investigations (
  id bigserial primary key,
  episode_id bigint not null references gamma_knife_episodes(id),
  reassessment_id bigint references gamma_knife_reassessments(id),
  requested_text text not null check (length(trim(requested_text)) > 0),
  responsible_user_id bigint references users(id),
  responsible_name_snapshot text,
  due_date date,
  status text not null default 'requested' check (status in ('requested','received','cancelled')),
  evidence_document_id bigint references documents(id),
  received_note text,
  created_by bigint not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'received' or received_note is not null or evidence_document_id is not null)
);

create index gamma_knife_investigation_outstanding
  on gamma_knife_investigations(episode_id, due_date, created_at)
  where status = 'requested';

create table gamma_knife_investigation_history (
  id bigserial primary key,
  investigation_id bigint not null references gamma_knife_investigations(id),
  action text not null,
  reason text not null default '',
  snapshot jsonb not null,
  actor_id bigint not null references users(id),
  created_at timestamptz not null default now()
);

-- Preserve completed historical data as a course summary. Deliberately create
-- no fraction rows: the old aggregate did not retain fraction-level evidence.
insert into gamma_knife_treatment_courses (
  episode_id, course_number, immobilization, planned_fraction_count, status,
  source, legacy_treatment_snapshot, completion_confirmed, completion_reason,
  completed_at, report_document_id, documentation_finalized, booking_id, created_at, updated_at
)
select e.id, 1, e.data->'treatment'->>'immobilization',
  (e.data->'treatment'->>'fractions')::integer, 'completed', 'legacy_import',
  e.data->'treatment', true,
  'Imported as a historical course summary; fraction-level details were not present in the source record.',
  (e.data->'treatment'->>'date')::date,
  case when e.data->'treatment'->>'reportId' ~ '^[1-9][0-9]*$' then (select d.id from documents d where d.id=(e.data->'treatment'->>'reportId')::bigint) else null end,
  coalesce((e.data->'treatment'->>'finalized')::boolean,false), nullif(e.data->'treatmentAppointment'->>'bookingId','')::bigint, e.created_at, e.updated_at
from gamma_knife_episodes e
where e.data->'treatment'->>'completed' = 'true';

-- Convert the old single outstanding-investigation note into a visible task.
-- Owner and due date intentionally remain unset because the legacy record did
-- not preserve either value.
insert into gamma_knife_investigations(episode_id,requested_text,status,created_by,created_at,updated_at)
select e.id, trim(e.data->'mdt'->>'investigations'), 'requested', e.created_by, e.updated_at, e.updated_at
from gamma_knife_episodes e
where e.data->>'investigationsPending' = 'true'
  and length(trim(coalesce(e.data->'mdt'->>'investigations',''))) > 0;
