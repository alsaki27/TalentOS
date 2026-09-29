-- Feature flag for Phase 4 of the AI Resume Pipeline Waste Removal & Quality
-- Hardening plan (2026-09-28): when true, Final Polish's AI call is skipped
-- for a draft that's already clean (zero Hiring Panel requiredEdits, page
-- fit already passing, deterministic QA reports ok:true). All of Final
-- Polish's existing deterministic post-processing still runs on the draft
-- either way - only the AI call is skipped. Defaults false so this needs the
-- plan's own A/B + blind-review exit gate before being enabled, and is
-- instantly revertible with a single UPDATE, no deploy required.
ALTER TABLE ai_runtime_config
  ADD COLUMN IF NOT EXISTS final_polish_skip_when_clean boolean NOT NULL DEFAULT false;
