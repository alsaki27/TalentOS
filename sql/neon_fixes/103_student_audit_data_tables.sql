-- Local copy of the Skarion Student Audit roster + sticky-notes log, imported
-- from the separate candidate_db Postgres via scripts/importStudentAudit.mjs.
-- TalentOS reads these tables directly (no live cross-database connection at
-- request time) — re-run the import script whenever fresher data is needed.
CREATE TABLE IF NOT EXISTS student_audit_students (
  id                  text PRIMARY KEY,
  name                text NOT NULL,
  domain              text,
  target_role         text,
  joining_date        text,
  progress            integer DEFAULT 0,
  mock_interviews     integer DEFAULT 0,
  rating              text DEFAULT 'good',
  placement_company   text,
  placement_role      text,
  placement_date      text,
  placement_readiness integer,
  source_created_at   timestamptz,
  synced_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS student_audit_sticky_notes (
  id                text PRIMARY KEY,
  student_id        text NOT NULL REFERENCES student_audit_students(id) ON DELETE CASCADE,
  date              text,
  content           text NOT NULL,
  category          text DEFAULT 'General',
  author            text DEFAULT 'Mayukh',
  accent            text DEFAULT 'navy',
  pinned            boolean DEFAULT false,
  source_created_at timestamptz,
  synced_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_audit_sticky_notes_student_id ON student_audit_sticky_notes(student_id);
