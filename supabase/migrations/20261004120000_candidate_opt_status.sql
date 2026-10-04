-- One current work-authorization/OPT status record per candidate.
-- Values intentionally remain text: the source tracker mixes date formats,
-- statuses, and free-form explanations that staff need to preserve and edit.
CREATE TABLE IF NOT EXISTS candidate_opt_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL UNIQUE REFERENCES candidates(id) ON DELETE CASCADE,
  ead_work_authorization_type text,
  application_filed_date date,
  application_filed_month_year text,
  application_filed_not_provided boolean NOT NULL DEFAULT false,
  receipt_notice_date date,
  receipt_notice_month_year text,
  receipt_notice_not_provided boolean NOT NULL DEFAULT false,
  biometrics_date date,
  biometrics_month_year text,
  biometrics_not_provided boolean NOT NULL DEFAULT false,
  processing_type text,
  premium_processing_status text,
  premium_trigger_plan text,
  uscis_current_status text,
  approval_date date,
  approval_month_year text,
  approval_not_provided boolean NOT NULL DEFAULT false,
  card_produced_date date,
  card_produced_month_year text,
  card_produced_not_provided boolean NOT NULL DEFAULT false,
  card_mailed_date date,
  card_mailed_month_year text,
  card_mailed_not_provided boolean NOT NULL DEFAULT false,
  ead_card_received_date date,
  ead_card_received_month_year text,
  ead_card_received_not_provided boolean NOT NULL DEFAULT false,
  expected_start_work_eligible_date text,
  ready_for_full_application_volume text,
  days_pending text,
  notes text,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (application_filed_date IS NOT NULL AND application_filed_month_year IS NULL AND NOT application_filed_not_provided)
    OR (application_filed_date IS NULL AND application_filed_month_year ~ '^\d{4}-(0[1-9]|1[0-2])$' AND NOT application_filed_not_provided)
    OR (application_filed_date IS NULL AND application_filed_month_year IS NULL)
  ),
  CHECK (
    (receipt_notice_date IS NOT NULL AND receipt_notice_month_year IS NULL AND NOT receipt_notice_not_provided)
    OR (receipt_notice_date IS NULL AND receipt_notice_month_year ~ '^\d{4}-(0[1-9]|1[0-2])$' AND NOT receipt_notice_not_provided)
    OR (receipt_notice_date IS NULL AND receipt_notice_month_year IS NULL)
  ),
  CHECK (
    (biometrics_date IS NOT NULL AND biometrics_month_year IS NULL AND NOT biometrics_not_provided)
    OR (biometrics_date IS NULL AND biometrics_month_year ~ '^\d{4}-(0[1-9]|1[0-2])$' AND NOT biometrics_not_provided)
    OR (biometrics_date IS NULL AND biometrics_month_year IS NULL)
  ),
  CHECK (
    (approval_date IS NOT NULL AND approval_month_year IS NULL AND NOT approval_not_provided)
    OR (approval_date IS NULL AND approval_month_year ~ '^\d{4}-(0[1-9]|1[0-2])$' AND NOT approval_not_provided)
    OR (approval_date IS NULL AND approval_month_year IS NULL)
  ),
  CHECK (
    (card_produced_date IS NOT NULL AND card_produced_month_year IS NULL AND NOT card_produced_not_provided)
    OR (card_produced_date IS NULL AND card_produced_month_year ~ '^\d{4}-(0[1-9]|1[0-2])$' AND NOT card_produced_not_provided)
    OR (card_produced_date IS NULL AND card_produced_month_year IS NULL)
  ),
  CHECK (
    (card_mailed_date IS NOT NULL AND card_mailed_month_year IS NULL AND NOT card_mailed_not_provided)
    OR (card_mailed_date IS NULL AND card_mailed_month_year ~ '^\d{4}-(0[1-9]|1[0-2])$' AND NOT card_mailed_not_provided)
    OR (card_mailed_date IS NULL AND card_mailed_month_year IS NULL)
  ),
  CHECK (
    (ead_card_received_date IS NOT NULL AND ead_card_received_month_year IS NULL AND NOT ead_card_received_not_provided)
    OR (ead_card_received_date IS NULL AND ead_card_received_month_year ~ '^\d{4}-(0[1-9]|1[0-2])$' AND NOT ead_card_received_not_provided)
    OR (ead_card_received_date IS NULL AND ead_card_received_month_year IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_candidate_opt_status_updated_at
  ON candidate_opt_status(updated_at DESC);
