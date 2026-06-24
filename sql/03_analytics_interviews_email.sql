-- ============================================================
-- TalentOS v2 — Analytics, Interview Management, Email Engine
-- Run in Supabase SQL editor.
-- ============================================================

-- ============================================================
-- INTERVIEW MANAGEMENT
-- ============================================================

CREATE TABLE IF NOT EXISTS interview_schedules (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id        uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  round_number          integer NOT NULL DEFAULT 1,
  round_name            text NOT NULL,
  scheduled_at          timestamptz,
  duration_minutes      integer DEFAULT 60,
  status                text DEFAULT 'scheduled',
  location              text,
  meeting_link          text,
  created_by            text NOT NULL,
  created_at            timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS interview_schedules_app_idx ON interview_schedules (application_id);
CREATE INDEX IF NOT EXISTS interview_schedules_status_idx ON interview_schedules (status);
CREATE INDEX IF NOT EXISTS interview_schedules_date_idx ON interview_schedules (scheduled_at);

CREATE TABLE IF NOT EXISTS interview_panel_members (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id           uuid NOT NULL REFERENCES interview_schedules(id) ON DELETE CASCADE,
  interviewer_id        text NOT NULL,
  role                  text DEFAULT 'interviewer',
  status                text DEFAULT 'pending',
  feedback_submitted    boolean DEFAULT false,
  created_at            timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS interview_panel_schedule_idx ON interview_panel_members (schedule_id);
CREATE INDEX IF NOT EXISTS interview_panel_interviewer_idx ON interview_panel_members (interviewer_id);

CREATE TABLE IF NOT EXISTS interview_scorecards (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id           uuid NOT NULL REFERENCES interview_schedules(id) ON DELETE CASCADE,
  panel_member_id       uuid NOT NULL REFERENCES interview_panel_members(id),
  overall_rating        integer CHECK (overall_rating BETWEEN 1 AND 5),
  recommendation        text,
  competencies          jsonb DEFAULT '[]',
  overall_notes         text,
  verdict_notes         text,
  submitted_at          timestamptz,
  created_at            timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scorecard_schedule_idx ON interview_scorecards (schedule_id);
CREATE INDEX IF NOT EXISTS scorecard_panel_idx ON interview_scorecards (panel_member_id);

CREATE TABLE IF NOT EXISTS interview_scorecard_templates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                text,
  name                  text NOT NULL,
  role_type             text,
  competencies          text[] DEFAULT '{}',
  is_default            boolean DEFAULT false,
  created_at            timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scorecard_template_org_idx ON interview_scorecard_templates (org_id);

-- ============================================================
-- EMAIL & COMMUNICATION ENGINE
-- ============================================================

CREATE TABLE IF NOT EXISTS email_templates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                text,
  name                  text NOT NULL,
  subject               text NOT NULL,
  body                  text NOT NULL,
  category              text DEFAULT 'general',
  is_default            boolean DEFAULT false,
  created_by            text NOT NULL,
  created_at            timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_template_org_idx ON email_templates (org_id);
CREATE INDEX IF NOT EXISTS email_template_category_idx ON email_templates (category);

CREATE TABLE IF NOT EXISTS email_sequences (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                text,
  name                  text NOT NULL,
  description           text,
  trigger_event         text,
  is_active             boolean DEFAULT true,
  created_by            text NOT NULL,
  created_at            timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_sequence_org_idx ON email_sequences (org_id);

CREATE TABLE IF NOT EXISTS email_sequence_steps (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id           uuid NOT NULL REFERENCES email_sequences(id) ON DELETE CASCADE,
  step_number           integer NOT NULL,
  template_id           uuid NOT NULL REFERENCES email_templates(id),
  delay_hours           integer NOT NULL DEFAULT 24,
  send_time             text,
  condition             text,
  created_at            timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sequence_step_sequence_idx ON email_sequence_steps (sequence_id);

CREATE TABLE IF NOT EXISTS email_logs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id          uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  template_id           uuid REFERENCES email_templates(id),
  sequence_id           uuid REFERENCES email_sequences(id),
  step_number           integer,
  subject               text NOT NULL,
  body                  text NOT NULL,
  status                text DEFAULT 'sent',
  opened_at             timestamptz,
  clicked_at            timestamptz,
  replied_at            timestamptz,
  error_message         text,
  sent_by               text,
  sent_at               timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_log_candidate_idx ON email_logs (candidate_id);
CREATE INDEX IF NOT EXISTS email_log_status_idx ON email_logs (status);
CREATE INDEX IF NOT EXISTS email_log_sent_idx ON email_logs (sent_at);

CREATE TABLE IF NOT EXISTS candidate_messages (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id          uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  direction             text NOT NULL,
  channel               text NOT NULL,
  subject               text,
  body                  text NOT NULL,
  sender_id             text,
  sender_name           text,
  read_at               timestamptz,
  created_at            timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS candidate_msg_candidate_idx ON candidate_messages (candidate_id);
CREATE INDEX IF NOT EXISTS candidate_msg_created_idx ON candidate_messages (created_at);

-- ============================================================
-- ANALYTICS HELPERS
-- ============================================================

-- Add source column to applications if not exists (for source tracking)
ALTER TABLE applications ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual';

-- Add created_by to applications for recruiter tracking
ALTER TABLE applications ADD COLUMN IF NOT EXISTS created_by text;

-- Update existing applications to set created_by from owner_id if null
UPDATE applications SET created_by = owner_id WHERE created_by IS NULL;

-- Add gender, ethnicity, location to candidates for diversity metrics
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS gender text;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS ethnicity text;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS country text;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS city text;

-- Create a function for funnel analytics
CREATE OR REPLACE FUNCTION get_funnel_counts(
  date_from timestamptz DEFAULT NULL,
  date_to timestamptz DEFAULT NULL
) RETURNS TABLE (
  stage text,
  count bigint
) AS $$
BEGIN
  RETURN QUERY
  SELECT 'sourced'::text, COUNT(*)::bigint FROM candidates
    WHERE (date_from IS NULL OR created_at >= date_from)
      AND (date_to IS NULL OR created_at <= date_to)
  UNION ALL
  SELECT 'applied', COUNT(*) FROM applications
    WHERE (date_from IS NULL OR created_at >= date_from)
      AND (date_to IS NULL OR created_at <= date_to)
  UNION ALL
  SELECT 'screened', COUNT(*) FROM applications
    WHERE status = 'screening'
      AND (date_from IS NULL OR created_at >= date_from)
      AND (date_to IS NULL OR created_at <= date_to)
  UNION ALL
  SELECT 'interviewed', COUNT(*) FROM interview_schedules
    WHERE status = 'completed'
      AND (date_from IS NULL OR scheduled_at >= date_from)
      AND (date_to IS NULL OR scheduled_at <= date_to)
  UNION ALL
  SELECT 'offered', COUNT(*) FROM applications
    WHERE status = 'offer'
      AND (date_from IS NULL OR created_at >= date_from)
      AND (date_to IS NULL OR created_at <= date_to)
  UNION ALL
  SELECT 'hired', COUNT(*) FROM candidates
    WHERE status = 'placed'
      AND (date_from IS NULL OR created_at >= date_from)
      AND (date_to IS NULL OR created_at <= date_to);
END;
$$ LANGUAGE plpgsql;
