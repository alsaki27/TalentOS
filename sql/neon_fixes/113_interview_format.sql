-- Explicit Online/Onsite selector for a scheduled interview, captured from
-- the quick "mark Interview" flow on the candidate dashboard and candidate
-- profile Applications tab (src/components/candidates/shared/
-- ApplicationsDataTable.tsx). Distinct from the existing free-text `location`
-- column (a 5-option platform picker: Zoom/Google Meet/In-Person/Phone/Other
-- from src/app/interviews/schedule/page.tsx) - that column conflates meeting
-- platform with online/onsite-ness, so a clean two-value field is added
-- instead of overloading it.
ALTER TABLE interview_schedules
  ADD COLUMN IF NOT EXISTS interview_format text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'interview_schedules_interview_format_check'
  ) THEN
    ALTER TABLE interview_schedules
      ADD CONSTRAINT interview_schedules_interview_format_check
      CHECK (interview_format IS NULL OR interview_format IN ('online', 'onsite'));
  END IF;
END $$;
