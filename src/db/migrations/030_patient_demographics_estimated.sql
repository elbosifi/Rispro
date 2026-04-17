alter table patients
  add column if not exists demographics_estimated boolean not null default false;

