ALTER TABLE comparison_requests
  ADD COLUMN IF NOT EXISTS materials_confirmed_by_name_ar_snapshot text,
  ADD COLUMN IF NOT EXISTS materials_confirmed_by_name_en_snapshot text,
  ADD COLUMN IF NOT EXISTS materials_confirmed_by_username_snapshot text,
  ADD COLUMN IF NOT EXISTS created_by_name_ar_snapshot text,
  ADD COLUMN IF NOT EXISTS created_by_name_en_snapshot text,
  ADD COLUMN IF NOT EXISTS created_by_username_snapshot text,
  ADD COLUMN IF NOT EXISTS preparation_returned_by_name_ar_snapshot text,
  ADD COLUMN IF NOT EXISTS preparation_returned_by_name_en_snapshot text,
  ADD COLUMN IF NOT EXISTS preparation_returned_by_username_snapshot text,
  ADD COLUMN IF NOT EXISTS cancelled_by_name_ar_snapshot text,
  ADD COLUMN IF NOT EXISTS cancelled_by_name_en_snapshot text,
  ADD COLUMN IF NOT EXISTS cancelled_by_username_snapshot text;
