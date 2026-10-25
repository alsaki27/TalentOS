-- 124: Scheduled candidate-job logging - two-stage matching redesign.
-- Stage 1 (unchanged code in candidateJobMatcher.ts, no migration needed for
-- it): deterministic keyword/ATS gate, now the authoritative 85% pass/fail
-- gate instead of a cheap pre-screen - see scheduledCandidateLoggingService.ts.
-- Stage 2 (AI, only for Stage-1 passers): a new shared-pool automation,
-- routed through the same OpenCode round-robin/fallback machinery as
-- application_resume_forge et al (src/lib/ai/routing.ts). Primary model
-- glm-5.3-flash, fallback qwen3.7-plus.
--
-- scheduled_candidate_logging_config.ai_provider/ai_model/ai_base_url/
-- ai_encrypted_api_key/ai_key_fingerprint are intentionally left unchanged -
-- the application code simply stops reading/writing them, preserving the
-- ability to restore the old dedicated-key design later.

INSERT INTO ai_automations (id, label, description, group_label, is_active)
VALUES (
  'scheduled_candidate_logging_eligibility_check',
  'Scheduled Candidate Logging - Eligibility Check',
  'Final AI eligibility check (job/resume fit, citizenship/clearance fit, years-of-experience fit) for scheduled candidate-job pairs that already passed the deterministic keyword/ATS gate.',
  'Scheduled Candidate Logging',
  true
)
ON CONFLICT (id) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  group_label = EXCLUDED.group_label,
  is_active = true;

INSERT INTO ai_automation_routes (automation_id, provider, rank, is_enabled, model_override)
VALUES
  ('scheduled_candidate_logging_eligibility_check', 'opencode', 1, true, 'glm-5.3-flash'),
  ('scheduled_candidate_logging_eligibility_check', 'opencode', 2, true, 'qwen3.7-plus')
ON CONFLICT (automation_id, rank) DO UPDATE SET
  provider = EXCLUDED.provider,
  is_enabled = true,
  model_override = EXCLUDED.model_override,
  updated_at = NOW();

ALTER TABLE scheduled_candidate_logging_config ALTER COLUMN match_threshold SET DEFAULT 85;

-- Unconditional: 85% is the explicit, required Stage-1 gate for this
-- redesign, not just a new default to apply where untouched. Confirmed live
-- before this migration: the row had already drifted to 50 (an earlier
-- experiment), which a WHERE match_threshold = 30 guard would have missed.
UPDATE scheduled_candidate_logging_config SET match_threshold = 85 WHERE id = true;

COMMENT ON COLUMN scheduled_candidate_logging_config.match_threshold IS
  'Minimum Stage-1 deterministic keyword/ATS score (0-100) required to proceed to the Stage-2 AI eligibility check; also reused as the Stage-2 AI score pass/fail cutoff. Default changed 30 -> 85 in migration 124.';
