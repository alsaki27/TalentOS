-- Durable outbox for recruiting contacts discovered in Gmail.
CREATE TABLE IF NOT EXISTS crm_contact_sync_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  application_id uuid REFERENCES applications(id) ON DELETE SET NULL,
  email_communication_id uuid REFERENCES email_communications(id) ON DELETE SET NULL,
  contact_email text NOT NULL,
  display_name text,
  contact_type text NOT NULL CHECK (contact_type IN ('recruiter','hiring_manager')),
  company text,
  source_subject text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','syncing','synced','failed','skipped')),
  crm_record_id text,
  crm_entity_type text,
  crm_record_url text,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  first_discovered_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  synced_at timestamptz,
  UNIQUE(candidate_id, contact_email)
);
CREATE INDEX IF NOT EXISTS crm_contact_sync_due_idx ON crm_contact_sync_queue(status, next_attempt_at) WHERE status IN ('pending','failed');
CREATE INDEX IF NOT EXISTS crm_contact_sync_candidate_idx ON crm_contact_sync_queue(candidate_id, first_discovered_at DESC);
