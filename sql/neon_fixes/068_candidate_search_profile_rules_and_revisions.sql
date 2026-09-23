-- 068: Forward-only profile rule/revision hardening.

ALTER TABLE candidate_resume_search_profiles
  ADD COLUMN IF NOT EXISTS rules_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS disabled_at timestamptz;

ALTER TABLE candidate_resume_search_profiles
  DROP CONSTRAINT IF EXISTS candidate_resume_search_profiles_review_status_check;
ALTER TABLE candidate_resume_search_profiles
  ADD CONSTRAINT candidate_resume_search_profiles_review_status_check
  CHECK (review_status IN ('pending', 'approved', 'needs_review', 'stale', 'disabled'));

CREATE TABLE IF NOT EXISTS candidate_resume_search_profile_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES candidate_resume_search_profiles(id) ON DELETE CASCADE,
  profile_version integer NOT NULL,
  keywords text[] NOT NULL DEFAULT '{}',
  keyword_states jsonb NOT NULL DEFAULT '[]'::jsonb,
  additional_rules text NOT NULL DEFAULT '',
  rules_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  review_status text NOT NULL,
  changed_by uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
DROP INDEX IF EXISTS candidate_search_profile_revision_unique;
CREATE INDEX IF NOT EXISTS candidate_search_profile_revision_idx
  ON candidate_resume_search_profile_revisions(profile_id, profile_version, changed_at DESC);

CREATE OR REPLACE FUNCTION capture_candidate_search_profile_revision()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.keywords IS DISTINCT FROM NEW.keywords
     OR OLD.keyword_states IS DISTINCT FROM NEW.keyword_states
     OR OLD.additional_rules IS DISTINCT FROM NEW.additional_rules
     OR OLD.rules_json IS DISTINCT FROM NEW.rules_json
     OR OLD.review_status IS DISTINCT FROM NEW.review_status THEN
    INSERT INTO candidate_resume_search_profile_revisions
      (profile_id, profile_version, keywords, keyword_states, additional_rules,
       rules_json, review_status, changed_by)
    VALUES
      (OLD.id, OLD.profile_version, OLD.keywords, OLD.keyword_states,
       OLD.additional_rules, OLD.rules_json, OLD.review_status, NEW.updated_by);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS candidate_search_profile_revision_trigger
  ON candidate_resume_search_profiles;
CREATE TRIGGER candidate_search_profile_revision_trigger
  BEFORE UPDATE ON candidate_resume_search_profiles
  FOR EACH ROW EXECUTE FUNCTION capture_candidate_search_profile_revision();

-- Existing oversized profiles remain visible for remediation, while every new
-- write is constrained. A later operational migration can VALIDATE after all
-- legacy rows are reviewed.
CREATE OR REPLACE FUNCTION candidate_active_keyword_count(states jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT COUNT(*)::integer
    FROM jsonb_array_elements(COALESCE(states, '[]'::jsonb)) item
   WHERE COALESCE(item->>'status', 'active') <> 'dismissed'
$$;

ALTER TABLE candidate_resume_search_profiles
  DROP CONSTRAINT IF EXISTS candidate_search_profile_active_keyword_max;
ALTER TABLE candidate_resume_search_profiles
  ADD CONSTRAINT candidate_search_profile_active_keyword_max CHECK (
    candidate_active_keyword_count(keyword_states) <= 48
  ) NOT VALID;

CREATE TABLE IF NOT EXISTS candidate_job_match_rule_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL REFERENCES candidate_job_match_decisions(id) ON DELETE CASCADE,
  rule_type text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('pass', 'reject', 'review')),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (decision_id, rule_type, reason)
);
CREATE INDEX IF NOT EXISTS candidate_job_match_rule_results_decision_idx
  ON candidate_job_match_rule_results(decision_id);
