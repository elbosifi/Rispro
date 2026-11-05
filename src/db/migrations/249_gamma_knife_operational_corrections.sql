alter table gamma_knife_episodes
  add column closure_classification text,
  add column replacement_episode_id bigint references gamma_knife_episodes(id);

update gamma_knife_episodes
set closure_classification = case
  when data->'mdt'->>'decision' = 'not_suitable' then 'not_suitable'
  else 'completed'
end
where active = false;

create function set_gamma_knife_closure_classification() returns trigger language plpgsql as $$
begin
  if new.active then
    new.closure_classification := null;
  elsif new.closure_classification is null then
    new.closure_classification := case
      when new.data->'mdt'->>'decision' = 'not_suitable' then 'not_suitable'
      else 'completed'
    end;
  end if;
  return new;
end $$;

create trigger gamma_knife_closure_classification_default
  before insert or update of active,status,data,closure_classification on gamma_knife_episodes
  for each row execute function set_gamma_knife_closure_classification();

alter table gamma_knife_episodes
  add constraint gamma_knife_episode_closure_classification_check
    check (closure_classification is null or closure_classification in ('not_suitable','withdrawn','entered_in_error','completed')),
  add constraint gamma_knife_episode_closure_state_check
    check ((active and closure_classification is null) or (not active and closure_classification is not null)),
  add constraint gamma_knife_episode_replacement_self_check
    check (replacement_episode_id is null or replacement_episode_id <> id);

create unique index gamma_knife_episode_single_replacement
  on gamma_knife_episodes(replacement_episode_id)
  where replacement_episode_id is not null;

drop index gamma_knife_one_course_per_reassessment;
create unique index gamma_knife_one_course_per_reassessment
  on gamma_knife_treatment_courses(reassessment_id)
  where reassessment_id is not null and status <> 'cancelled';
