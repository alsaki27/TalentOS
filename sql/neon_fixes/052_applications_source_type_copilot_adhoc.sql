-- 052: allow 'copilot_adhoc' as a valid applications.source_type.
-- Bug found while live-testing the Copilot fill-plan extension against 10 real
-- ATS forms: src/app/api/extension/v1/copilot/fill-plan/route.ts inserts an
-- ad-hoc application row with source_type='copilot_adhoc' whenever Analyze is
-- run without an existing applicationId, but that value was never added to
-- applications_source_type_check — every such insert failed with a 500. This
-- code path had apparently never been exercised end-to-end before.

ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_source_type_check;
ALTER TABLE applications ADD CONSTRAINT applications_source_type_check
  CHECK (source_type = ANY (ARRAY['base_resume'::text, 'original_resume'::text, 'blank'::text, 'manual'::text, 'copilot_adhoc'::text]));
