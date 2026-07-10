-- The explorer orders every page by timestamp and id, and commonly narrows the
-- immutable history by actor, entity, or action. These indexes avoid repeated
-- full scans for those supported filters without storing derived categories.
create index if not exists audit_log_created_at_id_desc_idx
  on audit_log (created_at desc, id desc);

create index if not exists audit_log_changed_by_user_id_idx
  on audit_log (changed_by_user_id);

create index if not exists audit_log_entity_type_idx
  on audit_log (entity_type);

create index if not exists audit_log_action_type_idx
  on audit_log (action_type);
