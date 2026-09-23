-- Allow AE-created applications discovered from external confirmation emails.
ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_source_type_check;
ALTER TABLE applications ADD CONSTRAINT applications_source_type_check
  CHECK (source_type = ANY (ARRAY['base_resume'::text, 'original_resume'::text, 'blank'::text, 'manual'::text, 'copilot_adhoc'::text, 'email_confirmation'::text]));
