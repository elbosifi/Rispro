alter table doctor_portal.case_team_assignments
  add column if not exists assignment_origin text not null default 'rispro';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'case_team_assignments_assignment_origin_check'
      and conrelid = 'doctor_portal.case_team_assignments'::regclass
  ) then
    alter table doctor_portal.case_team_assignments
      add constraint case_team_assignments_assignment_origin_check
      check (assignment_origin in ('rispro', 'sonic_auto', 'sonic_reconciled'));
  end if;
end $$;
