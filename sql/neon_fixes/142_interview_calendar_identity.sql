BEGIN;

ALTER TABLE interview_schedules
  ADD COLUMN IF NOT EXISTS calendar_event_key text,
  ADD COLUMN IF NOT EXISTS calendar_sequence integer,
  ADD COLUMN IF NOT EXISTS calendar_version_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS interview_schedules_app_calendar_event_idx
  ON interview_schedules (application_id, calendar_event_key)
  WHERE calendar_event_key IS NOT NULL;

COMMIT;
