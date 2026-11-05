-- Account-specific access boundary for clinicians who use only Gamma Knife.
-- Existing users retain their current access by default.
alter table users
  add column gamma_knife_only boolean not null default false;

comment on column users.gamma_knife_only is
  'Restricts an account to Gamma Knife, essential authentication, and medical dictation endpoints.';
