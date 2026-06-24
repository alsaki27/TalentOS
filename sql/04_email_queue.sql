-- Email queue table for drip campaign scheduling
CREATE TABLE IF NOT EXISTS email_queue (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id          uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  sequence_id           uuid NOT NULL REFERENCES email_sequences(id) ON DELETE CASCADE,
  step_number           integer NOT NULL,
  template_id           uuid NOT NULL REFERENCES email_templates(id),
  delay_hours           integer NOT NULL DEFAULT 24,
  trigger_at            timestamptz NOT NULL,
  status                text DEFAULT 'pending',
  sent_at               timestamptz,
  error                 text,
  created_at            timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_queue_status_trigger_idx ON email_queue (status, trigger_at);
CREATE INDEX IF NOT EXISTS email_queue_candidate_idx ON email_queue (candidate_id);