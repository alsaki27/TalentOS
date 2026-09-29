-- Phase 2 consumption point (c) of the AI Resume Pipeline Waste Removal &
-- Quality Hardening plan (2026-09-29): deterministicQa.ts's output was only
-- ever consumed in-memory (Phase 4's skip gate, Hiring Panel/Final Polish's
-- own prompt facts block) and then discarded - there was no record of what
-- it found, so nothing could be measured over time (how often bullet counts
-- drift out of range, how often skills fall outside the evidenced pool,
-- coverage trends, etc). Hiring Panel and Final Polish now attach their
-- computed DeterministicQaResult onto their own output (ReviewScoreV1.qa /
-- FinalResumeV1.qa) and processWorkflowStage persists it here. NULL for
-- Resume Forge's stage row (nothing to QA before a draft exists).
ALTER TABLE application_ai_stage_runs
  ADD COLUMN IF NOT EXISTS qa_facts jsonb;
