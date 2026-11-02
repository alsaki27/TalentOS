-- 12-hour important-email reminders, per-user opened/checked state, and
-- idempotent digest delivery. Overdue state is derived from email timestamps;
-- no separate overdue rows are retained.

CREATE TABLE IF NOT EXISTS email_thread_user_state (
  user_id text NOT NULL,
  gmail_thread_id text NOT NULL,
  viewed_at timestamptz,
  checked_through_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, gmail_thread_id)
);

CREATE INDEX IF NOT EXISTS email_thread_user_state_updated_idx
  ON email_thread_user_state (updated_at);

CREATE TABLE IF NOT EXISTS email_reminder_recipients (
  email text PRIMARY KEY,
  is_active boolean NOT NULL DEFAULT true,
  added_by_user_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_reminder_recipient_normalized
    CHECK (email = lower(btrim(email)) AND email <> '')
);

INSERT INTO email_reminder_recipients (email)
VALUES ('shohanhyder@gmail.com')
ON CONFLICT (email) DO NOTHING;

CREATE TABLE IF NOT EXISTS email_reminder_deliveries (
  slot_key text PRIMARY KEY,
  status text NOT NULL DEFAULT 'sending'
    CHECK (status IN ('sending', 'sent', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  recipient_count integer NOT NULL DEFAULT 0,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text
);

CREATE INDEX IF NOT EXISTS email_reminder_deliveries_started_idx
  ON email_reminder_deliveries (started_at);

CREATE TABLE IF NOT EXISTS email_reminder_delivery_recipients (
  slot_key text NOT NULL REFERENCES email_reminder_deliveries(slot_key) ON DELETE CASCADE,
  email text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  error_code text,
  PRIMARY KEY (slot_key, email)
);

CREATE INDEX IF NOT EXISTS email_comm_response_due_idx
  ON email_communications (sent_at, gmail_thread_id)
  WHERE direction = 'inbound' AND needs_reply = true AND replied_at IS NULL;

-- Repair rows incorrectly cleared by an older outbound message that predates
-- the inbound request. Only restore relevant mail with a known reply request.
UPDATE email_communications
   SET needs_reply = true,
       replied_at = NULL,
       response_due_at = sent_at + interval '24 hours',
       workflow_state = 'needs_action',
       escalation_level = 0
 WHERE direction = 'inbound'
   AND needs_reply = false
   AND replied_at IS NOT NULL
   AND replied_at < sent_at
   AND suppression_reason IS NULL
   AND ai_relevant IS DISTINCT FROM false
   AND ai_category IN ('interview_invite', 'scheduling', 'offer', 'recruiter_reply', 'application_invite', 'application_confirmation')
   AND NOT EXISTS (
     SELECT 1 FROM email_communications outbound
      WHERE outbound.gmail_thread_id = email_communications.gmail_thread_id
        AND outbound.direction = 'outbound'
        AND outbound.sent_at >= email_communications.sent_at
   );

-- Where a thread has a real later reply, replace any stale earlier timestamp
-- with the first qualifying sent message.
UPDATE email_communications inbound
   SET replied_at = (
         SELECT outbound.sent_at FROM email_communications outbound
          WHERE outbound.gmail_thread_id = inbound.gmail_thread_id
            AND outbound.direction = 'outbound'
            AND outbound.sent_at >= inbound.sent_at
          ORDER BY outbound.sent_at, outbound.id LIMIT 1
       ),
       response_due_at = NULL,
       workflow_state = 'resolved',
       escalation_level = 0
 WHERE inbound.direction = 'inbound'
   AND inbound.replied_at IS NOT NULL
   AND inbound.replied_at < inbound.sent_at
   AND EXISTS (
     SELECT 1 FROM email_communications outbound
      WHERE outbound.gmail_thread_id = inbound.gmail_thread_id
        AND outbound.direction = 'outbound'
        AND outbound.sent_at >= inbound.sent_at
   );

-- Standardize open reply deadlines to the requested 24-hour flag threshold.
UPDATE email_communications
   SET response_due_at = sent_at + interval '24 hours'
 WHERE direction = 'inbound'
   AND needs_reply = true
   AND replied_at IS NULL
   AND response_due_at IS DISTINCT FROM sent_at + interval '24 hours';

-- Resolve legacy reply tasks where a later sent message already exists in
-- that same Gmail thread, including replies imported before the inbound mail.
UPDATE action_items ai
   SET status = 'done',
       resolved_at = COALESCE(ai.resolved_at, now()),
       resolution_kind = 'outbound_thread_reply',
       resolved_by_email_communication_id = reply.id
  FROM email_communications inbound
  JOIN LATERAL (
    SELECT outbound.id
      FROM email_communications outbound
     WHERE outbound.gmail_thread_id = inbound.gmail_thread_id
       AND outbound.direction = 'outbound'
       AND outbound.sent_at >= inbound.sent_at
     ORDER BY outbound.sent_at, outbound.id
     LIMIT 1
  ) reply ON true
 WHERE ai.email_communication_id = inbound.id
   AND ai.type = 'needs_reply'
   AND ai.status IN ('open', 'in_progress')
   AND inbound.direction = 'inbound';

-- Make existing open reply tasks use the same 24-hour deadline as the inbox
-- reminder flag. The reminder UI derives its 7-day overdue window from mail
-- timestamps and does not retain separate overdue records.
UPDATE action_items ai
   SET due_at = inbound.sent_at + interval '24 hours'
  FROM email_communications inbound
 WHERE ai.email_communication_id = inbound.id
   AND ai.type IN ('needs_reply', 'untracked_application')
   AND ai.status IN ('open', 'in_progress')
   AND inbound.direction = 'inbound';
