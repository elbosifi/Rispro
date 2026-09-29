ALTER TABLE sops
  ADD COLUMN IF NOT EXISTS owner_user_id bigint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'sops'::regclass
      AND conname = 'sops_owner_user_id_fkey'
  ) THEN
    ALTER TABLE sops
      ADD CONSTRAINT sops_owner_user_id_fkey
      FOREIGN KEY (owner_user_id)
      REFERENCES users(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS sops_owner_user_id_idx
  ON sops (owner_user_id);

ALTER TABLE sop_versions
  ADD COLUMN IF NOT EXISTS next_review_date date;

CREATE INDEX IF NOT EXISTS sop_versions_next_review_date_idx
  ON sop_versions (next_review_date);
