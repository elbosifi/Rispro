update users
set email = btrim(username)
where email is null
  and btrim(username) ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$';
