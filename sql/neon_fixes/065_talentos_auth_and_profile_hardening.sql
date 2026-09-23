-- TalentOS production-authentication and search-profile safety primitives.

CREATE TABLE IF NOT EXISTS auth_oauth_states (
  state_hash text PRIMARY KEY,
  flow_type text NOT NULL CHECK (flow_type IN ('staff_google', 'candidate_google')),
  candidate_id uuid REFERENCES candidates(id) ON DELETE CASCADE,
  next_path text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_oauth_states_expiry_idx
  ON auth_oauth_states(expires_at)
  WHERE consumed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS integration_accounts_candidate_gmail_unique
  ON integration_accounts(provider, owner_type, candidate_id)
  WHERE provider = 'gmail' AND owner_type = 'candidate' AND candidate_id IS NOT NULL;

ALTER TABLE candidate_resume_search_profiles
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resume_content_hash text,
  ADD COLUMN IF NOT EXISTS approved_profile_version integer,
  ADD COLUMN IF NOT EXISTS profile_version integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'candidate_resume_search_profiles_review_status_check'
  ) THEN
    ALTER TABLE candidate_resume_search_profiles
      ADD CONSTRAINT candidate_resume_search_profiles_review_status_check
      CHECK (review_status IN ('pending', 'approved', 'needs_review', 'stale'));
  END IF;
END $$;

UPDATE candidate_resume_search_profiles
   SET review_status = 'needs_review', updated_at = NOW()
 WHERE (
   SELECT COUNT(*)
     FROM jsonb_array_elements(COALESCE(keyword_states, '[]'::jsonb)) item
    WHERE COALESCE(item->>'status', 'active') = 'active'
 ) > 48
   AND review_status <> 'needs_review';

UPDATE ai_agent_configs
   SET prompt_version = 'v1.2', updated_at = NOW()
 WHERE automation_id = 'BaseResume_TO_JobSearchKeyword'
   AND COALESCE(prompt_version, '') IN ('', 'v1.0', 'v1.1');
