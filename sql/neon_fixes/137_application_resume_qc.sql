-- Human QC for resumes while an application is in the AI pipeline or waiting
-- for AE review. Current state is kept separately from editable per-stage
-- notes and the append-only history so every decision and note edit is auditable.

CREATE TABLE IF NOT EXISTS application_resume_qc (
  application_id uuid PRIMARY KEY REFERENCES applications(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('qualified', 'doubt', 'unqualified')),
  changed_by_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  changed_by_name text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS application_resume_qc_notes (
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('qualified', 'doubt', 'unqualified')),
  note text NOT NULL CHECK (length(btrim(note)) > 0),
  created_by_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  created_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  updated_by_name text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (application_id, stage)
);

CREATE TABLE IF NOT EXISTS application_resume_qc_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('stage_changed', 'note_created', 'note_updated', 'note_deleted')),
  from_status text CHECK (from_status IS NULL OR from_status IN ('qualified', 'doubt', 'unqualified')),
  to_status text CHECK (to_status IS NULL OR to_status IN ('qualified', 'doubt', 'unqualified')),
  note_stage text CHECK (note_stage IS NULL OR note_stage IN ('qualified', 'doubt', 'unqualified')),
  old_note text,
  new_note text,
  actor_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  actor_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS application_resume_qc_events_application_idx
  ON application_resume_qc_events(application_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS application_resume_qc_status_idx
  ON application_resume_qc(status, changed_at DESC);

COMMENT ON TABLE application_resume_qc IS
  'Current admin-entered resume QC status for applications in the AI pipeline or AE review stage.';
COMMENT ON TABLE application_resume_qc_notes IS
  'Editable latest note per application and QC stage; prior text is retained in application_resume_qc_events.';
COMMENT ON TABLE application_resume_qc_events IS
  'Append-only audit history for resume QC stage changes and note creation, edits, or deletion.';
