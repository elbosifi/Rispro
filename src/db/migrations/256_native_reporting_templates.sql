-- Personal reusable templates contain only report section text. Reports copy
-- this content when created, so later template edits cannot alter report history.
create table native_reporting_templates (
  id bigserial primary key,
  owner_user_id bigint not null references users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  sections jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    jsonb_typeof(sections) = 'object'
    and sections ?& array['clinicalHistory','comparison','technique','findings','impression']
    and (sections - array['clinicalHistory','comparison','technique','findings','impression']::text[]) = '{}'::jsonb
    and jsonb_typeof(sections->'clinicalHistory') = 'string'
    and jsonb_typeof(sections->'comparison') = 'string'
    and jsonb_typeof(sections->'technique') = 'string'
    and jsonb_typeof(sections->'findings') = 'string'
    and jsonb_typeof(sections->'impression') = 'string'
    and length(sections->>'clinicalHistory') <= 20000
    and length(sections->>'comparison') <= 20000
    and length(sections->>'technique') <= 20000
    and length(sections->>'findings') <= 20000
    and length(sections->>'impression') <= 20000
    and length(sections->>'clinicalHistory')
      + length(sections->>'comparison')
      + length(sections->>'technique')
      + length(sections->>'findings')
      + length(sections->>'impression') <= 50000
  )
);

create unique index native_reporting_templates_owner_name_idx
  on native_reporting_templates(owner_user_id, lower(name));
create index native_reporting_templates_owner_updated_idx
  on native_reporting_templates(owner_user_id, updated_at desc, id);
