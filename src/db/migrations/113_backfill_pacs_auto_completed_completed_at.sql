do $$
declare
  eligible_count integer;
begin
  update appointments_v2.bookings
  set completed_at = auto_completed_at
  where status = 'completed'
    and completed_at is null
    and auto_completed_at is not null;

  get diagnostics eligible_count = row_count;
  raise notice 'Backfilled completed_at from auto_completed_at for % PACS-auto-completed bookings', eligible_count;
end $$;
