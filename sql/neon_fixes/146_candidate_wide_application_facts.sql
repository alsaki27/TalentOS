-- Preserve prior job-specific revisions while making current and future answers
-- candidate-wide. The data conversion requires an explicitly verified actor and
-- a fingerprint of the scoped latest revisions captured before execution.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = public, pg_catalog;
LOCK TABLE candidate_application_facts IN SHARE ROW EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION normalize_candidate_application_fact_scope() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_catalog AS $$
BEGIN
  NEW.job_id := NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS candidate_application_fact_candidate_scope ON candidate_application_facts;
CREATE TRIGGER candidate_application_fact_candidate_scope
  BEFORE INSERT OR UPDATE OF job_id ON candidate_application_facts
  FOR EACH ROW EXECUTE FUNCTION normalize_candidate_application_fact_scope();

DO $migration$
DECLARE
  migration_name constant text := '146_candidate_wide_application_facts';
  audit_id constant uuid := 'b4a96d18-6e46-43a3-a885-5bb567b8ff65';
  actor_id uuid;
  expected_count integer;
  expected_hash text;
  scoped_count integer;
  scoped_hash text;
  affected jsonb;
BEGIN
  IF EXISTS (SELECT FROM audit_logs WHERE id = audit_id) THEN
    IF NOT EXISTS (SELECT FROM audit_logs WHERE id = audit_id
      AND action = 'candidate_application_facts_scope_migrated'
      AND metadata->>'migration' = migration_name) THEN
      RAISE EXCEPTION 'The fact scope migration audit identifier is already in use';
    END IF;
    RETURN;
  END IF;

  WITH latest AS (
    SELECT DISTINCT ON (id) * FROM candidate_application_facts ORDER BY id, revision DESC
  )
  SELECT count(*)::integer,
    encode(sha256(convert_to(COALESCE(jsonb_agg(to_jsonb(latest) ORDER BY id, revision), '[]'::jsonb)::text, 'UTF8')), 'hex')
  INTO scoped_count, scoped_hash FROM latest WHERE job_id IS NOT NULL;

  IF scoped_count = 0 THEN RETURN; END IF;
  actor_id := NULLIF(current_setting('talentos.fact_scope_actor', true), '')::uuid;
  expected_count := NULLIF(current_setting('talentos.fact_scope_expected_count', true), '')::integer;
  expected_hash := NULLIF(current_setting('talentos.fact_scope_expected_sha256', true), '');
  IF actor_id IS NULL OR NOT EXISTS (
    SELECT FROM profiles WHERE user_id = actor_id AND is_active AND role IN ('admin', 'manager')
  ) THEN
    RAISE EXCEPTION 'An active authenticated admin or manager is required for the fact scope migration';
  END IF;
  IF expected_count IS NULL OR expected_hash IS NULL OR expected_hash !~ '^[a-f0-9]{64}$'
    OR scoped_count <> expected_count OR scoped_hash IS DISTINCT FROM expected_hash THEN
    RAISE EXCEPTION 'The fact scope snapshot changed or was not verified';
  END IF;

  WITH latest AS MATERIALIZED (
    SELECT DISTINCT ON (id) * FROM candidate_application_facts ORDER BY id, revision DESC
  ), inserted AS (
    INSERT INTO candidate_application_facts (
      id, revision, candidate_id, job_id, section, question, question_key, value_kind,
      disposition, answer_value, source_kind, source_ref, expires_at, review_state,
      created_by_user_id, created_at, reviewed_by_user_id, reviewed_at, revoked_by_user_id, revoked_at
    )
    SELECT id, revision + 1, candidate_id, NULL, section, question, question_key, value_kind,
      disposition, answer_value, source_kind, source_ref, expires_at, review_state,
      actor_id, now(), reviewed_by_user_id, reviewed_at, revoked_by_user_id, revoked_at
    FROM latest WHERE job_id IS NOT NULL
    RETURNING *
  )
  SELECT jsonb_agg(jsonb_build_object(
    'factId', i.id, 'candidateId', i.candidate_id, 'fromRevision', p.revision,
    'toRevision', i.revision, 'fromJobId', p.job_id, 'toJobId', NULL,
    'reviewState', i.review_state,
    'beforeSha256', encode(sha256(convert_to(to_jsonb(p)::text, 'UTF8')), 'hex'),
    'afterSha256', encode(sha256(convert_to(to_jsonb(i)::text, 'UTF8')), 'hex')
  ) ORDER BY i.id) INTO affected FROM inserted i JOIN latest p ON p.id = i.id;

  IF jsonb_array_length(affected) IS DISTINCT FROM scoped_count THEN
    RAISE EXCEPTION 'The fact scope migration did not append the expected revisions';
  END IF;
  INSERT INTO audit_logs (id, actor_user_id, action, entity_type, metadata)
  VALUES (audit_id, actor_id, 'candidate_application_facts_scope_migrated', 'candidate_application_facts',
    jsonb_build_object('migration', migration_name, 'previousScopedCount', scoped_count,
      'sourceSha256', scoped_hash, 'affected', affected));
END;
$migration$;
COMMIT;
