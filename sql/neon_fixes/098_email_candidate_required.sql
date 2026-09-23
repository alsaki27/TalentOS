-- Shared-mailbox messages must never be persisted without a candidate owner.
-- The constraint is intentionally NOT VALID so an existing deployment can
-- roll forward before its one-time cleanup; new inserts are rejected
-- immediately. The cleanup/validation runbook removes legacy NULL rows.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'email_communications_candidate_required'
       AND conrelid = 'email_communications'::regclass
  ) THEN
    ALTER TABLE email_communications
      ADD CONSTRAINT email_communications_candidate_required
      CHECK (candidate_id IS NOT NULL) NOT VALID;
  END IF;
END $$;
