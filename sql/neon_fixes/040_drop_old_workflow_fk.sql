-- Fix old foreign key that blocks Application/Workflow deletion
DO $$
BEGIN
  -- We already have arv_workflow_fk ON DELETE SET NULL from 011_identity_linkage_fields.sql
  -- Drop the original NO ACTION constraint if it exists.
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'application_resume_versions_workflow_id_fkey') THEN
    ALTER TABLE application_resume_versions DROP CONSTRAINT application_resume_versions_workflow_id_fkey;
  END IF;
END $$;
