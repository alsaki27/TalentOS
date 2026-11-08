-- Custom Interview Hub records are real application records, but they are not
-- sourced from a job board and must remain distinguishable from AI pipeline
-- applications.
ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_source_type_check;
ALTER TABLE applications ADD CONSTRAINT applications_source_type_check
  CHECK (source_type = ANY (ARRAY[
    'base_resume'::text,
    'original_resume'::text,
    'blank'::text,
    'manual'::text,
    'copilot_adhoc'::text,
    'email_confirmation'::text,
    'custom_interview'::text
  ]));
