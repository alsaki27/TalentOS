-- Candidate-mail replies arrive in the shared mailbox as forwarded inbound
-- messages. Treat a later message from the candidate's own mailbox as a team
-- reply when it is in the same Gmail thread, or has the same normalized
-- subject within the 15-day inbox window.

ALTER TABLE action_items
  DROP CONSTRAINT IF EXISTS action_items_resolution_kind_check;
ALTER TABLE action_items
  ADD CONSTRAINT action_items_resolution_kind_check
  CHECK (resolution_kind IS NULL OR resolution_kind IN (
    'outbound_thread_reply', 'forwarded_candidate_reply', 'manual_takeover',
    'manual_resolution', 'dismissed', 'informational'
  ));

CREATE OR REPLACE FUNCTION public.email_detected_team_reply_at(target_email_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $$
  SELECT MIN(reply.sent_at)
    FROM email_communications inbound
    JOIN candidates candidate ON candidate.id = inbound.candidate_id
    JOIN email_communications reply ON reply.candidate_id = inbound.candidate_id
   WHERE inbound.id = target_email_id
     AND inbound.direction = 'inbound'
     AND reply.id <> inbound.id
     AND reply.sent_at > inbound.sent_at
     AND (
       (reply.direction = 'outbound' AND reply.gmail_thread_id = inbound.gmail_thread_id)
       OR (
         reply.direction = 'inbound'
         AND lower(COALESCE(NULLIF(substring(reply.from_email FROM '<([^>]+)>'), ''), btrim(reply.from_email))) = lower(candidate.email)
         AND (
           reply.gmail_thread_id = inbound.gmail_thread_id
           OR (
             reply.sent_at <= inbound.sent_at + interval '15 days'
             AND NULLIF(btrim(inbound.subject), '') IS NOT NULL
             AND lower(regexp_replace(btrim(reply.subject), '^(?:(re|fw|fwd):[[:space:]]*)+', '', 'i'))
               = lower(regexp_replace(btrim(inbound.subject), '^(?:(re|fw|fwd):[[:space:]]*)+', '', 'i'))
           )
         )
       )
     );
$$;

CREATE OR REPLACE FUNCTION public.email_is_forwarded_candidate_reply(target_email_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM email_communications forwarded
      JOIN candidates candidate ON candidate.id = forwarded.candidate_id
     WHERE forwarded.id = target_email_id
       AND forwarded.direction = 'inbound'
       AND lower(COALESCE(NULLIF(substring(forwarded.from_email FROM '<([^>]+)>'), ''), btrim(forwarded.from_email))) = lower(candidate.email)
       AND EXISTS (
         SELECT 1
           FROM email_communications original
          WHERE original.candidate_id = forwarded.candidate_id
            AND original.direction = 'inbound'
            AND original.sent_at < forwarded.sent_at
            AND (
              original.gmail_thread_id = forwarded.gmail_thread_id
              OR (
                forwarded.sent_at <= original.sent_at + interval '15 days'
                AND NULLIF(btrim(original.subject), '') IS NOT NULL
                AND lower(regexp_replace(btrim(forwarded.subject), '^(?:(re|fw|fwd):[[:space:]]*)+', '', 'i'))
                  = lower(regexp_replace(btrim(original.subject), '^(?:(re|fw|fwd):[[:space:]]*)+', '', 'i'))
              )
            )
            AND (
              original.replied_at = forwarded.sent_at
              OR public.email_detected_team_reply_at(original.id) = forwarded.sent_at
            )
       )
  );
$$;

-- Reconcile candidate-forwarded replies already present in the mailbox.
UPDATE email_communications inbound
   SET needs_reply = false,
       replied_at = public.email_detected_team_reply_at(inbound.id),
       response_due_at = NULL,
       workflow_state = 'resolved',
       escalation_level = 0
 WHERE inbound.direction = 'inbound'
   AND inbound.sent_at >= now() - interval '15 days'
   AND inbound.needs_reply = true
   AND inbound.replied_at IS NULL
   AND public.email_detected_team_reply_at(inbound.id) IS NOT NULL;

UPDATE action_items ai
   SET status = 'done',
       resolved_at = COALESCE(ai.resolved_at, now()),
       resolution_kind = CASE WHEN reply.direction = 'inbound'
                              THEN 'forwarded_candidate_reply'
                              ELSE 'outbound_thread_reply' END,
       resolved_by_email_communication_id = reply.id
  FROM email_communications inbound
  JOIN LATERAL (
    SELECT response.id, response.direction
      FROM email_communications response
     WHERE response.candidate_id = inbound.candidate_id
       AND response.sent_at = public.email_detected_team_reply_at(inbound.id)
     ORDER BY response.id
     LIMIT 1
  ) reply ON true
 WHERE ai.email_communication_id = inbound.id
   AND ai.type = 'needs_reply'
   AND ai.status IN ('open', 'in_progress')
   AND inbound.direction = 'inbound'
   AND inbound.sent_at >= now() - interval '15 days'
   AND public.email_detected_team_reply_at(inbound.id) IS NOT NULL;
