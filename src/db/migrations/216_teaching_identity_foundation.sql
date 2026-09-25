create schema if not exists teaching;

create table if not exists teaching.user_profiles (
  identity_issuer text not null,
  identity_subject text not null,
  display_name text not null,
  specialty text,
  training_level text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (identity_issuer, identity_subject)
);

create table if not exists teaching.user_permissions (
  identity_issuer text not null,
  identity_subject text not null,
  permission text not null check (permission in (
    'teaching.access',
    'teaching.learn',
    'teaching.author',
    'teaching.review',
    'teaching.publish',
    'teaching.manage_taxonomy',
    'teaching.manage_sources',
    'teaching.manage_users',
    'teaching.view_cohort_analytics',
    'teaching.admin'
  )),
  granted_at timestamptz not null default now(),
  primary key (identity_issuer, identity_subject, permission),
  foreign key (identity_issuer, identity_subject)
    references teaching.user_profiles (identity_issuer, identity_subject)
    on delete cascade
);

create index if not exists teaching_user_permissions_permission_idx
  on teaching.user_permissions (permission, identity_issuer, identity_subject);
