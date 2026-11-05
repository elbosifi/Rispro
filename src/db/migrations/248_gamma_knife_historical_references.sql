-- Historical references are evidence only; they confer no treatment approval.
create table gamma_knife_historical_references (
  id bigserial primary key,
  episode_id bigint not null references gamma_knife_episodes(id),
  prior_episode_id bigint not null references gamma_knife_episodes(id),
  prior_course_id bigint references gamma_knife_treatment_courses(id),
  reason text not null check (length(trim(reason)) > 0),
  created_by bigint not null references users(id),
  created_at timestamptz not null default now(),
  check (episode_id <> prior_episode_id),
  unique(episode_id, prior_episode_id)
);

create function validate_gamma_knife_historical_reference() returns trigger language plpgsql as $$
begin
  if not exists(select 1 from gamma_knife_episodes current
    join gamma_knife_episodes prior on prior.patient_id=current.patient_id
    where current.id=new.episode_id and current.active and prior.id=new.prior_episode_id
      and not prior.active and prior.created_at <= current.created_at
      and ((new.prior_course_id is not null and exists(select 1 from gamma_knife_treatment_courses c
        where c.id=new.prior_course_id and c.episode_id=prior.id and c.status='completed'))
        or (new.prior_course_id is null and (prior.data->'treatment'->>'completed')::boolean is true))) then
    raise exception 'Historical treatment reference requires a completed treatment in an earlier closed episode of the same patient' using errcode='23514';
  end if;
  return new;
end $$;
create trigger gamma_knife_historical_reference_valid before insert or update on gamma_knife_historical_references
  for each row execute function validate_gamma_knife_historical_reference();
