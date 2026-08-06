-- 047_ae_applied_attribution.sql
-- Mirrors the existing ae_reviewed_by_* capture (stamped on
-- ready_for_review -> ready_for_application, never overwritten later) with
-- the same pattern for the final ready_for_application -> applied
-- transition, so whoever applies is attributed the same way whoever
-- reviewed already is. Additive only.

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS ae_applied_by_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ae_applied_by_name text,
  ADD COLUMN IF NOT EXISTS ae_applied_at timestamptz;
