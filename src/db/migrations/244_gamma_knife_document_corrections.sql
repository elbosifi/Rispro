-- Documents are never hard-deleted from a clinical episode. This supports
-- audited removal from the current view while keeping storage and history.
alter table gamma_knife_documents
  add column removed_at timestamptz,
  add column removed_by_user_id bigint references users(id) on delete set null,
  add column removal_reason text;

alter table gamma_knife_documents
  add constraint gamma_knife_documents_removal_state_check
  check ((removed_at is null and removed_by_user_id is null and removal_reason is null)
      or (removed_at is not null and removal_reason is not null and length(trim(removal_reason)) > 0));
