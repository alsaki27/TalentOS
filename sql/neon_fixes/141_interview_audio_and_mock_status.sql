-- Existing preparation documents remain linked to their applications.
-- New preparation documents have no schedule_id. Audio uses the stage ID.
ALTER TABLE interview_schedules
  ADD COLUMN IF NOT EXISTS mock_interview_taken boolean,
  ADD COLUMN IF NOT EXISTS previous_scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS previous_time_zone text;
