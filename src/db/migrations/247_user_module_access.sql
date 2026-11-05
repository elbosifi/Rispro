-- Additive compatibility: legacy accounts retain their existing authorization.
alter table users
  add column module_access_mode text not null default 'legacy' check (module_access_mode in ('legacy','restricted')),
  add column default_landing_module text;

create table user_module_grants (
  user_id bigint not null references users(id) on delete cascade,
  module_id text not null check (module_id ~ '^[a-z][a-z0-9-]{0,63}$'),
  granted_by bigint references users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, module_id)
);

insert into user_module_grants(user_id,module_id)
select id,'gamma-knife' from users where gamma_knife_only;
update users set module_access_mode='restricted', default_landing_module='gamma-knife' where gamma_knife_only;

comment on column users.module_access_mode is 'legacy preserves pre-migration access; restricted admits only persisted grants intersected with module capabilities';
comment on column users.gamma_knife_only is 'Compatibility mirror. Module admission is controlled by module_access_mode and user_module_grants.';

-- Catch legacy integrations that still set gamma_knife_only. Never allow a stale
-- compatibility write to silently turn a restricted account into an unrestricted one.
create function sync_legacy_gamma_knife_module_access() returns trigger language plpgsql as $$
begin
  if new.gamma_knife_only and new.module_access_mode='legacy' then
    update users set module_access_mode='restricted',default_landing_module='gamma-knife' where id=new.id;
    delete from user_module_grants where user_id=new.id;
    insert into user_module_grants(user_id,module_id) values(new.id,'gamma-knife');
  end if;
  return new;
end $$;
create trigger users_legacy_gamma_knife_modules after insert or update of gamma_knife_only on users
  for each row execute function sync_legacy_gamma_knife_module_access();
