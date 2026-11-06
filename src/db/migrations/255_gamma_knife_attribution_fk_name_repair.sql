-- PostgreSQL truncated the original inline FK to this name. Migrations 253/254
-- dropped a similar but non-matching name, leaving a restrictive duplicate.
alter table gamma_knife_patient_attribution_corrections
  drop constraint if exists gamma_knife_patient_attribution_corre_corrected_patient_id_fkey;
