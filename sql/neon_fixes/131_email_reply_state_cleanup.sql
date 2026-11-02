-- Replace per-user viewed/checked state with a shared reply outcome.
-- The legacy table was backed up before this migration; a checked thread that
-- was still waiting for a reply is preserved as a manual reply assertion.

SET lock_timeout = '5s';

ALTER TABLE email_communications
  ADD COLUMN IF NOT EXISTS manual_replied_at timestamptz;

DO $$
BEGIN
  IF to_regclass('public.email_thread_user_state') IS NOT NULL THEN
WITH current_checked AS (
  SELECT state.gmail_thread_id,
         MAX(state.checked_through_at) AS checked_at,
         (array_agg(state.user_id ORDER BY state.checked_through_at DESC NULLS LAST))[1] AS checked_by
    FROM email_thread_user_state state
   WHERE state.checked_through_at IS NOT NULL
     AND state.checked_through_at >= (
       SELECT MAX(inbound.ingested_at)
         FROM email_communications inbound
        WHERE inbound.gmail_thread_id = state.gmail_thread_id
          AND inbound.direction = 'inbound'
     )
   GROUP BY state.gmail_thread_id
)
UPDATE email_communications inbound
   SET needs_reply = false,
       manual_replied_at = checked.checked_at,
       response_due_at = NULL,
       workflow_state = 'resolved',
       escalation_level = 0
  FROM current_checked checked
 WHERE inbound.gmail_thread_id = checked.gmail_thread_id
   AND inbound.direction = 'inbound'
   AND inbound.needs_reply = true
   AND inbound.replied_at IS NULL
   AND inbound.manual_replied_at IS NULL
   AND public.email_detected_team_reply_at(inbound.id) IS NULL;

WITH current_checked AS (
  SELECT state.gmail_thread_id,
         MAX(state.checked_through_at) AS checked_at,
         (array_agg(state.user_id ORDER BY state.checked_through_at DESC NULLS LAST))[1] AS checked_by
    FROM email_thread_user_state state
   WHERE state.checked_through_at IS NOT NULL
     AND state.checked_through_at >= (
       SELECT MAX(inbound.ingested_at)
         FROM email_communications inbound
        WHERE inbound.gmail_thread_id = state.gmail_thread_id
          AND inbound.direction = 'inbound'
     )
   GROUP BY state.gmail_thread_id
)
UPDATE action_items ai
   SET status = 'done',
       resolved_at = COALESCE(ai.resolved_at, now()),
       resolved_by_user_id = checked.checked_by::uuid,
       resolution_kind = 'manual_resolution',
       decision_note = 'Migrated checked thread to marked replied'
  FROM email_communications inbound
  JOIN current_checked checked ON checked.gmail_thread_id = inbound.gmail_thread_id
 WHERE ai.email_communication_id = inbound.id
   AND ai.type = 'needs_reply'
   AND ai.status IN ('open', 'in_progress')
   AND inbound.direction = 'inbound'
   AND inbound.manual_replied_at = checked.checked_at;

UPDATE notifications n
   SET read_at = COALESCE(n.read_at, now())
  FROM email_communications ec
 WHERE n.entity_type = 'email_communication'
   AND n.entity_id = ec.id
   AND n.type IN ('email_reply_waiting', 'email_reply_overdue')
   AND ec.manual_replied_at IS NOT NULL
   AND n.read_at IS NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS email_communications_manual_replied_at_idx
  ON email_communications (manual_replied_at)
  WHERE manual_replied_at IS NOT NULL;

DROP TABLE IF EXISTS email_thread_user_state;

RESET lock_timeout;
