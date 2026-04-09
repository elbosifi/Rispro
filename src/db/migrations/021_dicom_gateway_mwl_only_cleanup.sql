-- Migration 021: MWL-only cleanup for lingering DICOM gateway leftovers.
-- Safe to run on databases that already applied earlier cleanup migrations.
-- Keeps scan_started_at and scan_finished_at on appointments.

BEGIN;

ALTER TABLE dicom_devices DROP COLUMN IF EXISTS mpps_enabled;
ALTER TABLE appointments DROP COLUMN IF EXISTS mpps_sop_instance_uid;

DELETE FROM system_settings
WHERE category = 'dicom_gateway'
  AND setting_key IN (
    'mpps_ae_title',
    'mpps_port',
    'mpps_inbox_dir',
    'mpps_processed_dir',
    'mpps_failed_dir'
  );

ALTER TABLE dicom_message_log DROP CONSTRAINT IF EXISTS dicom_message_log_source_type_check;
ALTER TABLE dicom_message_log ADD CONSTRAINT dicom_message_log_source_type_check
  CHECK (source_type IN ('worklist'));

COMMIT;
