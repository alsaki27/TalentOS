-- Remove duplicate indexes flagged by Supabase performance advisor.
-- Existing jobs_active_idx and jobs_tier_idx already cover these columns.

drop index if exists jobs_is_active_idx;
drop index if exists jobs_role_tier_idx;
