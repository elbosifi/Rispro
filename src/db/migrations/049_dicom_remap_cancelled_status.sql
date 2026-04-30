alter table dicom_remap_jobs
  add column if not exists cancellation_reason text;

do $$
declare
  constraint_name text;
begin
  select conname
    into constraint_name
  from pg_constraint
  where conrelid = 'dicom_remap_jobs'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%status%'
    and pg_get_constraintdef(oid) like '%uploaded%'
    and pg_get_constraintdef(oid) like '%failed%'
  limit 1;

  if constraint_name is not null then
    execute format('alter table dicom_remap_jobs drop constraint %I', constraint_name);
  end if;
end $$;

alter table dicom_remap_jobs
  add constraint dicom_remap_jobs_status_check
  check (status in ('uploaded', 'awaiting_confirmation', 'remapped', 'sending', 'sent', 'failed', 'cancelled'));
