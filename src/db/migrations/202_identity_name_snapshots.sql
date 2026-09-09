ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS changed_by_name_ar_snapshot text,
  ADD COLUMN IF NOT EXISTS changed_by_name_en_snapshot text,
  ADD COLUMN IF NOT EXISTS changed_by_username_snapshot text;

UPDATE audit_log a
SET changed_by_name_ar_snapshot = COALESCE(a.changed_by_name_ar_snapshot, u.full_name),
    changed_by_name_en_snapshot = COALESCE(a.changed_by_name_en_snapshot, u.english_name),
    changed_by_username_snapshot = COALESCE(a.changed_by_username_snapshot, u.username)
FROM users u
WHERE u.id = a.changed_by_user_id;

ALTER TABLE department_incidents
  ADD COLUMN IF NOT EXISTS reporter_name_ar_snapshot text,
  ADD COLUMN IF NOT EXISTS reporter_name_en_snapshot text,
  ADD COLUMN IF NOT EXISTS reporter_username_snapshot text,
  ADD COLUMN IF NOT EXISTS reviewer_name_ar_snapshot text,
  ADD COLUMN IF NOT EXISTS reviewer_name_en_snapshot text,
  ADD COLUMN IF NOT EXISTS reviewer_username_snapshot text;

UPDATE department_incidents i
SET reporter_name_ar_snapshot = COALESCE(i.reporter_name_ar_snapshot, u.full_name),
    reporter_name_en_snapshot = COALESCE(i.reporter_name_en_snapshot, u.english_name),
    reporter_username_snapshot = COALESCE(i.reporter_username_snapshot, u.username)
FROM users u
WHERE u.id = i.reported_by_user_id;

UPDATE department_incidents i
SET reviewer_name_ar_snapshot = COALESCE(i.reviewer_name_ar_snapshot, u.full_name),
    reviewer_name_en_snapshot = COALESCE(i.reviewer_name_en_snapshot, u.english_name),
    reviewer_username_snapshot = COALESCE(i.reviewer_username_snapshot, u.username)
FROM users u
WHERE u.id = i.reviewed_by_user_id;

ALTER TABLE comparison_requests
  ADD COLUMN IF NOT EXISTS finalized_by_name_ar_snapshot text,
  ADD COLUMN IF NOT EXISTS finalized_by_name_en_snapshot text,
  ADD COLUMN IF NOT EXISTS finalized_by_username_snapshot text;

UPDATE comparison_requests c
SET finalized_by_name_ar_snapshot = COALESCE(c.finalized_by_name_ar_snapshot, u.full_name),
    finalized_by_name_en_snapshot = COALESCE(c.finalized_by_name_en_snapshot, u.english_name),
    finalized_by_username_snapshot = COALESCE(c.finalized_by_username_snapshot, u.username)
FROM users u
WHERE u.id = c.finalized_by;

ALTER TABLE doctor_portal.reporting_board_sonicdicom_cache
  ADD COLUMN IF NOT EXISTS finalized_by_name_ar_snapshot text,
  ADD COLUMN IF NOT EXISTS finalized_by_name_en_snapshot text,
  ADD COLUMN IF NOT EXISTS finalized_by_username_snapshot text;

UPDATE doctor_portal.reporting_board_sonicdicom_cache c
SET finalized_by_name_ar_snapshot = COALESCE(c.finalized_by_name_ar_snapshot, u.full_name),
    finalized_by_name_en_snapshot = COALESCE(c.finalized_by_name_en_snapshot, u.english_name),
    finalized_by_username_snapshot = COALESCE(c.finalized_by_username_snapshot, u.username)
FROM doctor_portal.doctor_profiles dp
JOIN users u ON u.id = dp.user_id
WHERE dp.id = c.finalized_by_doctor_id;

ALTER TABLE doctor_portal.appointment_protocol_audit_events
  ADD COLUMN IF NOT EXISTS changed_by_name_ar_snapshot text,
  ADD COLUMN IF NOT EXISTS changed_by_name_en_snapshot text,
  ADD COLUMN IF NOT EXISTS changed_by_username_snapshot text;

UPDATE doctor_portal.appointment_protocol_audit_events a
SET changed_by_name_ar_snapshot = COALESCE(a.changed_by_name_ar_snapshot, u.full_name),
    changed_by_name_en_snapshot = COALESCE(a.changed_by_name_en_snapshot, u.english_name),
    changed_by_username_snapshot = COALESCE(a.changed_by_username_snapshot, u.username)
FROM doctor_portal.doctor_profiles dp
JOIN users u ON u.id = dp.user_id
WHERE dp.id = a.changed_by_doctor_id;

ALTER TABLE doctor_portal.doctor_module_audit_events
  ADD COLUMN IF NOT EXISTS actor_name_ar_snapshot text,
  ADD COLUMN IF NOT EXISTS actor_name_en_snapshot text,
  ADD COLUMN IF NOT EXISTS actor_username_snapshot text;

UPDATE doctor_portal.doctor_module_audit_events a
SET actor_name_ar_snapshot = COALESCE(a.actor_name_ar_snapshot, u.full_name),
    actor_name_en_snapshot = COALESCE(a.actor_name_en_snapshot, u.english_name),
    actor_username_snapshot = COALESCE(a.actor_username_snapshot, u.username)
FROM users u
WHERE u.id = a.actor_user_id;

UPDATE doctor_portal.doctor_module_audit_events a
SET actor_name_ar_snapshot = COALESCE(a.actor_name_ar_snapshot, u.full_name),
    actor_name_en_snapshot = COALESCE(a.actor_name_en_snapshot, u.english_name),
    actor_username_snapshot = COALESCE(a.actor_username_snapshot, u.username)
FROM doctor_portal.doctor_profiles dp
JOIN users u ON u.id = dp.user_id
WHERE a.actor_user_id IS NULL
  AND dp.id = a.actor_doctor_id;
