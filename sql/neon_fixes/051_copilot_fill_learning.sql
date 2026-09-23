-- 049: Copilot fill-plan learning loop.
-- Records what the AI guessed per field vs. what the AE actually left in the
-- field once they finished reviewing/fixing it. fill-plan queries this table
-- for recent corrections (by domain, and separately by candidate) and feeds
-- them back into the prompt as few-shot examples so accuracy improves without
-- retraining anything.

CREATE TABLE IF NOT EXISTS copilot_fill_corrections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  uuid REFERENCES applications(id) ON DELETE CASCADE,
  candidate_id    uuid REFERENCES candidates(id) ON DELETE CASCADE,
  domain          text NOT NULL,
  field_label     text,
  field_selector  text,
  field_type      text,
  ai_value        text,
  ai_confidence   text,
  ai_reasoning    text,
  final_value     text,
  was_corrected   boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS copilot_fill_corrections_domain_idx
  ON copilot_fill_corrections (domain, created_at DESC);
CREATE INDEX IF NOT EXISTS copilot_fill_corrections_candidate_idx
  ON copilot_fill_corrections (candidate_id, created_at DESC);
