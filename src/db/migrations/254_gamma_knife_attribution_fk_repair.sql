-- Migration 253 added archival ON DELETE SET NULL references, but the original
-- inline FK names were PostgreSQL-truncated and therefore survived its drop.
alter table gamma_knife_patient_attribution_corrections
  drop constraint if exists gamma_knife_patient_attribution_correc_original_patient_id_fkey,
  drop constraint if exists gamma_knife_patient_attribution_correc_corrected_patient_id_fkey;

