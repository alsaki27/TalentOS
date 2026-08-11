-- 072: An application ticket is not an external application.
-- The legacy schema defaulted applied_at to NOW() for every INSERT, which
-- made assigned/AI-pipeline tickets appear applied in candidate dashboards.
-- The application stage transition route is responsible for setting this
-- timestamp when an AE actually moves a ticket to applied.

ALTER TABLE applications
  ALTER COLUMN applied_at DROP DEFAULT;

-- Repair only tickets created by the current approved-match batch. These were
-- explicitly created in the AI pipeline and have no external submission.
UPDATE applications
   SET applied_at = NULL
 WHERE assignment_note = 'Approved strong-match shortlist; queued for Akash review'
   AND ae_stage IN ('in_ai_pipeline', 'ready_for_review', 'ready_for_application')
   AND proof_url IS NULL
   AND submission_url IS NULL;
