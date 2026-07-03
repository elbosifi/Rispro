alter table imaging_scanners
  add column if not exists ct_slice_detector_specification text;

alter table protocols
  add column if not exists oral_contrast_policy text,
  add column if not exists bowel_preparation text,
  add column if not exists preparation_notes text;
