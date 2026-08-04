do $$
begin
  if exists (
    select 1
    from users
    group by lower(btrim(username))
    having count(*) > 1
  ) then
    raise exception 'Cannot normalize usernames: case or surrounding-whitespace duplicates exist. Resolve conflicting users before applying migration 159.';
  end if;
end $$;

update users
set username = lower(btrim(username))
where username is distinct from lower(btrim(username));

create unique index if not exists users_username_normalized_unique
  on users (lower(btrim(username)));
