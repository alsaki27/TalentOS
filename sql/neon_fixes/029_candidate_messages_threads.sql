-- 029_candidate_messages_threads.sql
-- Add Gmail threading columns, status column, and indexes for the
-- candidate-message draft-approval-send flow (Candidate Portal Overhaul).
-- Idempotent: wraps each ADD COLUMN in a DO block checking information_schema.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='candidate_messages' AND column_name='gmail_message_id') THEN
    ALTER TABLE candidate_messages ADD COLUMN gmail_message_id text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='candidate_messages' AND column_name='gmail_thread_id') THEN
    ALTER TABLE candidate_messages ADD COLUMN gmail_thread_id text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='candidate_messages' AND column_name='in_reply_to') THEN
    ALTER TABLE candidate_messages ADD COLUMN in_reply_to text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='candidate_messages' AND column_name='references_header') THEN
    ALTER TABLE candidate_messages ADD COLUMN references_header text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='candidate_messages' AND column_name='from_address') THEN
    ALTER TABLE candidate_messages ADD COLUMN from_address text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='candidate_messages' AND column_name='to_address') THEN
    ALTER TABLE candidate_messages ADD COLUMN to_address text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='candidate_messages' AND column_name='cc_address') THEN
    ALTER TABLE candidate_messages ADD COLUMN cc_address text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='candidate_messages' AND column_name='status') THEN
    ALTER TABLE candidate_messages ADD COLUMN status text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='candidate_messages' AND column_name='approved_by') THEN
    ALTER TABLE candidate_messages ADD COLUMN approved_by text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='candidate_messages' AND column_name='approved_at') THEN
    ALTER TABLE candidate_messages ADD COLUMN approved_at timestamptz;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='candidate_messages' AND column_name='sent_via_gmail_message_id') THEN
    ALTER TABLE candidate_messages ADD COLUMN sent_via_gmail_message_id text;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS candidate_msg_thread_idx ON candidate_messages (candidate_id, gmail_thread_id);
CREATE INDEX IF NOT EXISTS candidate_msg_gmail_msg_idx ON candidate_messages (gmail_message_id);
CREATE INDEX IF NOT EXISTS candidate_msg_status_idx ON candidate_messages (status) WHERE status IS NOT NULL;
