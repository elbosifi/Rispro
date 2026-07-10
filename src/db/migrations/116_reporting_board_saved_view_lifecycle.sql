alter table doctor_portal.reporting_board_saved_views
  add column if not exists last_accessed_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists revoked_at timestamptz,
  add column if not exists access_mode text not null default 'public_readonly';

create index if not exists reporting_board_saved_views_public_token_lifecycle_idx
  on doctor_portal.reporting_board_saved_views(token)
  where active = true and revoked_at is null;
