-- Preserve exact AI request/response payloads and the human-edited resume state
-- at each save and AE handoff. Additive and safe to apply more than once.

BEGIN;

ALTER TABLE application_resume_versions
  ADD COLUMN IF NOT EXISTS updated_by_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_source text NOT NULL DEFAULT 'legacy_unknown';

CREATE TABLE IF NOT EXISTS ai_call_traces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usage_event_id uuid REFERENCES ai_usage_events(id) ON DELETE SET NULL,
  automation_id text NOT NULL,
  provider text NOT NULL,
  model text,
  ai_key_id uuid REFERENCES ai_api_keys(id) ON DELETE SET NULL,
  route_id text,
  route_rank integer,
  routing_state_id text,
  triggered_by_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  application_id uuid REFERENCES applications(id) ON DELETE CASCADE,
  workflow_id uuid REFERENCES application_ai_workflows(id) ON DELETE CASCADE,
  stage_run_id uuid REFERENCES application_ai_stage_runs(id) ON DELETE SET NULL,
  prompt_version text,
  stage_attempt_number integer,
  provider_attempt_number integer NOT NULL DEFAULT 1,
  request_sequence integer NOT NULL DEFAULT 1,
  request_payload jsonb NOT NULL,
  response_payload jsonb,
  response_text text,
  request_hash text NOT NULL,
  response_hash text,
  outcome text NOT NULL CHECK (outcome IN ('success', 'failure', 'timeout')),
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  error_code text,
  error_message text,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ai_call_traces
  ADD COLUMN IF NOT EXISTS routing_state_id text;

CREATE INDEX IF NOT EXISTS ai_call_traces_application_time_idx
  ON ai_call_traces (application_id, created_at DESC)
  WHERE application_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_call_traces_workflow_stage_idx
  ON ai_call_traces (workflow_id, stage_run_id, created_at)
  WHERE workflow_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_call_traces_model_time_idx
  ON ai_call_traces (automation_id, provider, model, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_call_traces_state_model_time_idx
  ON ai_call_traces (routing_state_id, automation_id, model, created_at DESC)
  WHERE routing_state_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_call_traces_usage_event_idx
  ON ai_call_traces (usage_event_id)
  WHERE usage_event_id IS NOT NULL;

COMMENT ON TABLE ai_call_traces IS
  'Exact provider request and response for each send() made through callWithUsageTracking; request payload excludes provider credentials and may contain candidate data.';
COMMENT ON COLUMN ai_call_traces.request_payload IS
  'Exact system prompt, ordered messages, tools, and generation settings passed to AiProvider.send.';
COMMENT ON COLUMN ai_call_traces.response_payload IS
  'Raw provider AiResponse before agent parsing or post-processing.';

CREATE TABLE IF NOT EXISTS application_resume_edit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resume_version_id uuid REFERENCES application_resume_versions(id) ON DELETE SET NULL,
  application_id uuid REFERENCES applications(id) ON DELETE CASCADE,
  candidate_id uuid REFERENCES candidates(id) ON DELETE CASCADE,
  job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  workflow_id uuid REFERENCES application_ai_workflows(id) ON DELETE SET NULL,
  base_resume_id uuid REFERENCES base_resumes(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  actor_name text,
  event_type text NOT NULL CHECK (event_type IN ('version_created', 'content_updated')),
  edit_source text NOT NULL,
  source_type text,
  before_content jsonb,
  after_content jsonb,
  before_formatting jsonb,
  after_formatting jsonb,
  before_generated_text text,
  after_generated_text text,
  change_patch jsonb NOT NULL DEFAULT '{}'::jsonb,
  before_hash text,
  after_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS application_resume_edit_events_application_time_idx
  ON application_resume_edit_events (application_id, created_at DESC)
  WHERE application_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS application_resume_edit_events_version_time_idx
  ON application_resume_edit_events (resume_version_id, created_at DESC)
  WHERE resume_version_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS application_resume_edit_events_actor_time_idx
  ON application_resume_edit_events (actor_user_id, created_at DESC)
  WHERE actor_user_id IS NOT NULL;

COMMENT ON TABLE application_resume_edit_events IS
  'Append-only before/after snapshots for application resume version creation and content edits, including editor attribution when supplied by the API.';
COMMENT ON COLUMN application_resume_edit_events.change_patch IS
  'Top-level before/after differences; full snapshots are retained alongside it for exact reconstruction.';

CREATE OR REPLACE FUNCTION capture_application_resume_version_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_application_id uuid;
  v_job_id uuid;
  v_actor_id uuid;
  v_actor_name text;
  v_event_type text;
  v_edit_source text;
  v_patch jsonb := '{}'::jsonb;
  v_key text;
  v_before_hash text;
  v_after_hash text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.content IS NOT DISTINCT FROM OLD.content
       AND NEW.formatting IS NOT DISTINCT FROM OLD.formatting
       AND NEW.generated_text IS NOT DISTINCT FROM OLD.generated_text THEN
      RETURN NEW;
    END IF;

    v_event_type := 'content_updated';
    v_edit_source := COALESCE(NULLIF(NEW.updated_source, ''), 'legacy_unknown');
    v_actor_id := NEW.updated_by_user_id;

    FOR v_key IN
      SELECT jsonb_object_keys(COALESCE(OLD.content, '{}'::jsonb) || COALESCE(NEW.content, '{}'::jsonb))
    LOOP
      IF OLD.content -> v_key IS DISTINCT FROM NEW.content -> v_key THEN
        v_patch := v_patch || jsonb_build_object(
          'content.' || v_key,
          jsonb_build_object('before', OLD.content -> v_key, 'after', NEW.content -> v_key)
        );
      END IF;
    END LOOP;
    IF OLD.formatting IS DISTINCT FROM NEW.formatting THEN
      v_patch := v_patch || jsonb_build_object(
        'formatting', jsonb_build_object('before', OLD.formatting, 'after', NEW.formatting)
      );
    END IF;
    IF OLD.generated_text IS DISTINCT FROM NEW.generated_text THEN
      v_patch := v_patch || jsonb_build_object(
        'generated_text', jsonb_build_object('before', OLD.generated_text, 'after', NEW.generated_text)
      );
    END IF;
    v_before_hash := md5(concat_ws('|', OLD.content::text, OLD.formatting::text, OLD.generated_text));
  ELSE
    v_event_type := 'version_created';
    v_actor_id := NEW.created_by;
    v_edit_source := COALESCE(
      NULLIF(NULLIF(NEW.updated_source, ''), 'legacy_unknown'),
      CASE
        WHEN NEW.source_type = 'manual' THEN 'manual_version_created'
        WHEN NEW.workflow_id IS NOT NULL THEN 'ai_pipeline_version_created'
        ELSE 'resume_version_created'
      END
    );
    v_patch := jsonb_build_object('version_created', true);
  END IF;

  IF v_actor_id IS NOT NULL THEN
    SELECT p.display_name INTO v_actor_name
    FROM profiles p WHERE p.user_id = v_actor_id;
  END IF;

  v_application_id := NEW.application_id;
  IF v_application_id IS NULL THEN
    SELECT p.application_id INTO v_application_id
    FROM application_packets p
    WHERE p.resume_version_id = NEW.id OR p.final_resume_version_id = NEW.id
    ORDER BY p.updated_at DESC NULLS LAST
    LIMIT 1;
  END IF;

  v_job_id := NEW.job_id;
  IF v_job_id IS NULL THEN
    SELECT tj.job_id INTO v_job_id
    FROM target_jobs tj WHERE tj.id = NEW.target_job_id;
  END IF;

  v_after_hash := md5(concat_ws('|', NEW.content::text, NEW.formatting::text, NEW.generated_text));

  INSERT INTO application_resume_edit_events (
    resume_version_id, application_id, candidate_id, job_id, workflow_id,
    base_resume_id, actor_user_id, actor_name, event_type, edit_source,
    source_type, before_content, after_content, before_formatting,
    after_formatting, before_generated_text, after_generated_text,
    change_patch, before_hash, after_hash, created_at
  ) VALUES (
    NEW.id, v_application_id, NEW.candidate_id, v_job_id, NEW.workflow_id,
    NEW.base_resume_id, v_actor_id, v_actor_name, v_event_type, v_edit_source,
    NEW.source_type,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.content ELSE NULL END,
    NEW.content,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.formatting ELSE NULL END,
    NEW.formatting,
    CASE WHEN TG_OP = 'UPDATE' THEN OLD.generated_text ELSE NULL END,
    NEW.generated_text,
    v_patch, v_before_hash, v_after_hash, COALESCE(NEW.updated_at, NEW.created_at, now())
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS application_resume_version_change_audit ON application_resume_versions;
CREATE TRIGGER application_resume_version_change_audit
  AFTER INSERT OR UPDATE OF content, formatting, generated_text
  ON application_resume_versions
  FOR EACH ROW
  EXECUTE FUNCTION capture_application_resume_version_change();

CREATE TABLE IF NOT EXISTS application_resume_ready_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage_history_id uuid NOT NULL UNIQUE REFERENCES application_stage_history(id) ON DELETE CASCADE,
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  candidate_id uuid REFERENCES candidates(id) ON DELETE CASCADE,
  job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  resume_version_id uuid REFERENCES application_resume_versions(id) ON DELETE SET NULL,
  base_resume_id uuid REFERENCES base_resumes(id) ON DELETE SET NULL,
  workflow_id uuid REFERENCES application_ai_workflows(id) ON DELETE SET NULL,
  reviewer_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  reviewer_name text,
  resume_content jsonb,
  resume_formatting jsonb,
  generated_text text,
  content_hash text,
  capture_status text NOT NULL CHECK (capture_status IN ('captured', 'missing_resume_version', 'missing_resume_content')),
  captured_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS application_resume_ready_snapshots_application_time_idx
  ON application_resume_ready_snapshots (application_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS application_resume_ready_snapshots_candidate_time_idx
  ON application_resume_ready_snapshots (candidate_id, captured_at DESC)
  WHERE candidate_id IS NOT NULL;

COMMENT ON TABLE application_resume_ready_snapshots IS
  'Immutable copy of the exact resume content and formatting present when an application enters ready_for_application through the queue.';

CREATE OR REPLACE FUNCTION capture_application_resume_ready_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_candidate_id uuid;
  v_job_id uuid;
  v_resume_version_id uuid;
  v_base_resume_id uuid;
  v_workflow_id uuid;
  v_content jsonb;
  v_formatting jsonb;
  v_generated_text text;
  v_status text := 'missing_resume_version';
BEGIN
  IF NEW.source IS DISTINCT FROM 'queue'
     OR NEW.to_stage IS DISTINCT FROM 'ready_for_application' THEN
    RETURN NEW;
  END IF;

  SELECT a.candidate_id, a.job_id,
         COALESCE(p.final_resume_version_id, a.tailored_resume_version_id, p.resume_version_id),
         p.base_resume_id
  INTO v_candidate_id, v_job_id, v_resume_version_id, v_base_resume_id
  FROM applications a
  LEFT JOIN application_packets p ON p.application_id = a.id
  WHERE a.id = NEW.application_id;

  IF v_resume_version_id IS NOT NULL THEN
    SELECT rv.content, rv.formatting, rv.generated_text, rv.base_resume_id, rv.workflow_id
    INTO v_content, v_formatting, v_generated_text, v_base_resume_id, v_workflow_id
    FROM application_resume_versions rv
    WHERE rv.id = v_resume_version_id;
    IF FOUND THEN
      v_status := CASE WHEN v_content IS NULL THEN 'missing_resume_content' ELSE 'captured' END;
    ELSE
      v_resume_version_id := NULL;
    END IF;
  END IF;

  INSERT INTO application_resume_ready_snapshots (
    stage_history_id, application_id, candidate_id, job_id, resume_version_id,
    base_resume_id, workflow_id, reviewer_user_id, reviewer_name,
    resume_content, resume_formatting, generated_text, content_hash,
    capture_status, captured_at
  ) VALUES (
    NEW.id, NEW.application_id, v_candidate_id, v_job_id, v_resume_version_id,
    v_base_resume_id, v_workflow_id, NEW.changed_by_user_id, NEW.changed_by_name,
    v_content, v_formatting, v_generated_text,
    CASE WHEN v_content IS NULL THEN NULL
         ELSE md5(concat_ws('|', v_content::text, v_formatting::text, v_generated_text)) END,
    v_status, COALESCE(NEW.changed_at, now())
  ) ON CONFLICT (stage_history_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS application_ready_resume_snapshot ON application_stage_history;
CREATE TRIGGER application_ready_resume_snapshot
  AFTER INSERT ON application_stage_history
  FOR EACH ROW
  EXECUTE FUNCTION capture_application_resume_ready_snapshot();

REVOKE ALL ON TABLE ai_call_traces, application_resume_edit_events,
  application_resume_ready_snapshots FROM PUBLIC;

COMMIT;
