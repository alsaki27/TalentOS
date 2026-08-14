CREATE TABLE IF NOT EXISTS gmail_sender_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_email text,
  sender_domain text,
  sender_class text NOT NULL CHECK (sender_class IN ('job_board_alert','no_reply','human_recruiter','hiring_manager','employer_system','personal','unknown')),
  creates_tasks boolean NOT NULL DEFAULT false,
  can_change_stage boolean NOT NULL DEFAULT false,
  notes text,
  created_by_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  updated_by_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gmail_sender_rule_target_check CHECK (sender_email IS NOT NULL OR sender_domain IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS gmail_sender_rules_email_unique ON gmail_sender_rules(lower(sender_email)) WHERE sender_email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS gmail_sender_rules_domain_unique ON gmail_sender_rules(lower(sender_domain)) WHERE sender_domain IS NOT NULL;
