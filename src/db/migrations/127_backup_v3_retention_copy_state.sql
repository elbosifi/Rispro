alter table backup_destination_copy_attempts drop constraint if exists backup_destination_copy_attempts_status_check;
alter table backup_destination_copy_attempts add constraint backup_destination_copy_attempts_status_check
  check (status in ('queued', 'copying', 'verified', 'failed', 'cancelled', 'deleted'));
