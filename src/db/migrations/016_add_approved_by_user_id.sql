-- Add approved_by_user_id column to appointments table for proper audit trail
-- This tracks which supervisor approved an overbooking

alter table appointments
add column if not exists approved_by_user_id bigint references users(id);

create index if not exists appointments_approved_by_user_id_idx
  on appointments (approved_by_user_id);

-- Add comment for documentation
comment on column appointments.approved_by_user_id is
  'The supervisor user who approved this overbooking (if is_overbooked is true)';
