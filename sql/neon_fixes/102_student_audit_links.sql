-- Links a TalentOS candidate to a row in the separate Skarion Student Audit
-- database (candidate_db on the VPS). candidate_db has no reliable automatic
-- key back to TalentOS (email is unpopulated, names don't line up 1:1), so
-- this mapping is created manually via the Training Audit tab's search-and-link
-- flow and stored here rather than in the external database.
CREATE TABLE IF NOT EXISTS student_audit_links (
  candidate_id     uuid PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  audit_student_id text NOT NULL,
  linked_at        timestamptz NOT NULL DEFAULT now(),
  linked_by        uuid REFERENCES profiles(user_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_student_audit_links_student_id ON student_audit_links(audit_student_id);
