-- Per-stage notes (staff-only) and reschedule tracking for interview_schedules.
-- round_number already serves as the interview "stage" (NOT NULL DEFAULT 1
-- since table creation, auto-incremented per application by the scheduling
-- code), so every existing row is already correctly numbered - no backfill.
ALTER TABLE interview_schedules
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS rescheduled_at timestamptz;
