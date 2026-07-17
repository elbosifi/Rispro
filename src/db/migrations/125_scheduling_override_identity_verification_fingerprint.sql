alter table appointments_v2.scheduling_override_requests
  add column if not exists patient_identity_verification_fingerprint text null;
