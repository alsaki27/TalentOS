-- Persist the timezone used when an interview's wall-clock time was entered.
-- scheduled_at remains the canonical UTC instant for querying and reminders;
-- time_zone preserves the selected display zone for every schedule screen.
ALTER TABLE interview_schedules
  ADD COLUMN IF NOT EXISTS time_zone text NOT NULL DEFAULT 'America/New_York';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'interview_schedules_time_zone_check'
  ) THEN
    ALTER TABLE interview_schedules
      ADD CONSTRAINT interview_schedules_time_zone_check
      CHECK (time_zone IN (
        'America/New_York',
        'America/Chicago',
        'America/Denver',
        'America/Los_Angeles',
        'America/Phoenix'
      ));
  END IF;
END $$;
