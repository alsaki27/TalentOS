-- 126: Split the scheduled candidate-logging match threshold into two
-- independent, admin-configurable values. match_threshold stays as Stage 1's
-- deterministic keyword/ATS gate (free, no AI cost - no reason to loosen it).
-- This adds a separate Stage 2 AI eligibility score threshold, since the two
-- scores measure different things (keyword density vs. an AI's judged
-- confidence) and reusing one number for both was making Stage 2 pass/fail
-- on a bar it wasn't tuned for. Default 75, below Stage 1's 85, based on
-- real Stage 2 score data reviewed live: of 6 Stage-1 passers scored by
-- Stage 2 so far, 4 were clear, well-justified rejects (score 35-42,
-- missing mandatory skills or wrong domain) that a lower threshold wouldn't
-- rescue, and 1 was a genuine borderline case (score 78) that 75 would pass
-- while the clear rejects still correctly fail.

ALTER TABLE scheduled_candidate_logging_config
  ADD COLUMN IF NOT EXISTS ai_match_threshold integer NOT NULL DEFAULT 75
    CHECK (ai_match_threshold BETWEEN 0 AND 100);

COMMENT ON COLUMN scheduled_candidate_logging_config.ai_match_threshold IS
  'Stage-2 AI eligibility score cutoff (0-100): a Stage-1 passer only becomes a real match/application when the AI eligibility score is at least this value and returns zero hard gates. Independent of match_threshold, which remains Stage 1''s deterministic keyword/ATS gate.';

COMMENT ON COLUMN scheduled_candidate_logging_config.match_threshold IS
  'Minimum Stage-1 deterministic keyword/ATS score (0-100) to proceed to Stage 2. No longer doubles as the Stage-2 cutoff - see ai_match_threshold (migration 126).';
