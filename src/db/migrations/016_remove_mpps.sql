-- Migration 016: Remove MPPS columns and settings (MWL only)
-- MPPS SCP has been removed from the codebase. This migration cleans up
-- the database schema while preserving scan_started_at and scan_finished_at
-- on appointments (useful for tracking scan timing independently).

BEGIN;

-- Drop MPPS from devices
ALTER TABLE dicom_devices DROP COLUMN IF EXISTS mpps_enabled;

-- Drop MPPS SOP tracking from appointments (scan_started_at/scan_finished_at stay)
ALTER TABLE appointments DROP COLUMN IF EXISTS mpps_sop_instance_uid;

-- Drop MPPS settings
DELETE FROM system_settings WHERE category = 'dicom_gateway' AND setting_key IN (
  'mpps_ae_title',
  'mpps_port',
  'mpps_inbox_dir',
  'mpps_processed_dir',
  'mpps_failed_dir'
);

-- Update check constraint on dicom_message_log.source_type to remove 'mpps'
-- First drop existing constraint if it exists
ALTER TABLE dicom_message_log DROP CONSTRAINT IF EXISTS dicom_message_log_source_type_check;

-- Recreate with only valid source types
ALTER TABLE dicom_message_log ADD CONSTRAINT dicom_message_log_source_type_check
  CHECK (source_type IN ('worklist'));

COMMIT;
