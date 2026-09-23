-- Durable application-to-email links. One email may relate to multiple
-- applications; the existing ai_matched_application_id remains a primary hint.
CREATE TABLE IF NOT EXISTS application_email_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  email_communication_id uuid NOT NULL REFERENCES email_communications(id) ON DELETE CASCADE,
  match_method text NOT NULL DEFAULT 'ai',
  match_confidence numeric(4,3),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, email_communication_id)
);
CREATE INDEX IF NOT EXISTS application_email_links_application_idx
  ON application_email_links(application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS application_email_links_email_idx
  ON application_email_links(email_communication_id);
