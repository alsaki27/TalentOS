-- Additive, staff-managed candidate activities. Deletes remain recoverable.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
CREATE TABLE IF NOT EXISTS candidate_custom_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 20000),
  link text CHECK (link IS NULL OR (length(link) <= 2000 AND link ~* '^https?://')),
  schedule_mode text NOT NULL DEFAULT 'none' CHECK (schedule_mode IN ('none','date','date_range','time_range')),
  start_date date, end_date date, starts_at timestamptz, ends_at timestamptz, time_zone text,
  created_by uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  updated_by uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  CHECK (
    (schedule_mode='none' AND start_date IS NULL AND end_date IS NULL AND starts_at IS NULL AND ends_at IS NULL AND time_zone IS NULL) OR
    (schedule_mode='date' AND start_date IS NOT NULL AND end_date IS NULL AND starts_at IS NULL AND ends_at IS NULL AND time_zone IS NOT NULL) OR
    (schedule_mode='date_range' AND start_date IS NOT NULL AND end_date IS NOT NULL AND end_date >= start_date AND starts_at IS NULL AND ends_at IS NULL AND time_zone IS NOT NULL) OR
    (schedule_mode='time_range' AND start_date IS NULL AND end_date IS NULL AND starts_at IS NOT NULL AND ends_at IS NOT NULL AND ends_at > starts_at AND time_zone IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS candidate_custom_activities_candidate_updated_idx
  ON candidate_custom_activities(candidate_id, updated_at DESC, id) WHERE deleted_at IS NULL;
ALTER TABLE candidate_custom_activities ENABLE ROW LEVEL SECURITY;
COMMIT;
