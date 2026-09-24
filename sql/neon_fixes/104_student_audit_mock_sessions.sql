-- Mock-interview sessions for the local Skarion Student Audit copy. Created
-- and edited going forward directly in TalentOS (the Training Audit tab) —
-- candidate_db's own mock_sessions_json blob is a one-time historical import
-- only (see scripts/importStudentAudit.mjs) and is not kept in sync after this.
CREATE TABLE IF NOT EXISTS student_audit_mock_sessions (
  id                  text PRIMARY KEY,
  student_id          text NOT NULL REFERENCES student_audit_students(id) ON DELETE CASCADE,
  session_date        text NOT NULL,
  target_role         text,
  transcript_source   text DEFAULT 'teams',
  transcript_raw_text text,
  raw_analysis_text   text,
  overall_score       numeric,
  overall_score_max   numeric DEFAULT 10,
  created_by          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_audit_mock_sessions_student_id ON student_audit_mock_sessions(student_id);
