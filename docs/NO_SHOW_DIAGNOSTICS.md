# No-show worker production diagnostics

Run these read-only checks against the deployed database. They do not update bookings or settings.

```sql
select setting_key, setting_value
from system_settings
where category = 'queue_and_arrival'
  and setting_key in ('no_show_review_time', 'no_show_grace_minutes', 'auto_no_show_enabled', 'no_show_confirmation_required', 'auto_no_show_cleanup_days')
order by setting_key;

select count(*) as historical_scheduled_count, min(booking_date) as oldest_date, max(booking_date) as newest_date
from appointments_v2.bookings
where status = 'scheduled'
  and booking_date < timezone('Africa/Tripoli', now())::date;

select id, booking_date, booking_time, status, updated_at, updated_by_user_id
from appointments_v2.bookings
where status = 'scheduled'
  and booking_date < timezone('Africa/Tripoli', now())::date
order by booking_date asc, id asc
limit 100;

select * from appointments_v2.no_show_worker_state;

select filename, applied_at
from schema_migrations
where filename in ('116_no_show_review_worker.sql', '117_no_show_worker_historical_state.sql');
```

Also record the deployed image tag or `git rev-parse HEAD` from the running container, inspect the startup log for `no_show_worker_started`, and inspect recent structured logs for `automatic_no_show_run_completed` and `no_show_worker_failed`.
