do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'appointments_v2'
      and t.relname = 'bookings'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%capacity_resolution_mode%'
  loop
    execute format('alter table appointments_v2.bookings drop constraint %I', constraint_name);
  end loop;
end $$;

alter table appointments_v2.bookings
  add constraint bookings_capacity_resolution_mode_check
  check (capacity_resolution_mode in ('standard', 'category_override', 'total_capacity_override', 'special_quota_extra'));
