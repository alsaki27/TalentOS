-- Interview preparation belongs to an existing application and interview round.
ALTER TABLE interview_schedules ADD COLUMN IF NOT EXISTS preparation_notes text;

CREATE TABLE IF NOT EXISTS interview_preparation_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  schedule_id uuid REFERENCES interview_schedules(id) ON DELETE SET NULL,
  filename text NOT NULL,
  content_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 20971520),
  sharepoint_item_id text NOT NULL,
  visible_to_candidate boolean NOT NULL DEFAULT true,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz
);

CREATE INDEX IF NOT EXISTS interview_preparation_files_active_idx
  ON interview_preparation_files (application_id, schedule_id, uploaded_at)
  WHERE removed_at IS NULL;
