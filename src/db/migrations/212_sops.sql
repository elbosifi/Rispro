create table if not exists sops (
  id bigserial primary key,
  code text not null,
  title text not null,
  category text not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  current_version text,
  created_by_user_id bigint not null references users(id) on delete restrict,
  updated_by_user_id bigint references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists sops_code_lower_unique_idx on sops (lower(code));
create index if not exists sops_status_updated_idx on sops (status, updated_at desc, id desc);
create index if not exists sops_category_status_idx on sops (category, status, updated_at desc);

create table if not exists sop_versions (
  id bigserial primary key,
  sop_id bigint not null references sops(id) on delete restrict,
  version text not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'superseded')),
  content_json jsonb not null,
  change_summary text not null default '',
  effective_date date,
  created_by_user_id bigint not null references users(id) on delete restrict,
  updated_by_user_id bigint references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_by_user_id bigint references users(id) on delete set null,
  published_at timestamptz,
  unique (sop_id, version),
  constraint sop_versions_published_fields_check check (
    (status = 'published' and published_at is not null and published_by_user_id is not null)
    or (status <> 'published')
  )
);

create unique index if not exists sop_versions_one_draft_per_sop_idx
  on sop_versions (sop_id) where status = 'draft';
create index if not exists sop_versions_sop_created_idx on sop_versions (sop_id, created_at desc, id desc);
create index if not exists sop_versions_status_idx on sop_versions (status, created_at desc);
