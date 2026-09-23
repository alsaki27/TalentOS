-- Fix old foreign keys that block Application deletion
DO $$
BEGIN
  -- We already have arv_application_fk ON DELETE SET NULL from 011_identity_linkage_fields.sql
  -- Drop the original NO ACTION constraint if it exists.
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'application_resume_versions_application_id_fkey') THEN
    ALTER TABLE application_resume_versions DROP CONSTRAINT application_resume_versions_application_id_fkey;
  END IF;
  
  -- ai_usage_events doesn't have an ON DELETE clause in 007_ai_control_center_schema.sql (likely defaults to NO ACTION)
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_usage_events_application_id_fkey') THEN
    ALTER TABLE ai_usage_events DROP CONSTRAINT ai_usage_events_application_id_fkey;
    ALTER TABLE ai_usage_events ADD CONSTRAINT ai_usage_events_application_id_fkey 
      FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE SET NULL;
  END IF;
END $$;
