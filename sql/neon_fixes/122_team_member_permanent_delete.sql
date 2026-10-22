-- Preserve audit attribution and revoke owned extension credentials when an
-- administrator permanently removes a team member.

BEGIN;

ALTER TABLE extension_activity_events
  ADD COLUMN IF NOT EXISTS actor_display_name text,
  ADD COLUMN IF NOT EXISTS actor_email text;

UPDATE extension_activity_events e
   SET actor_display_name = COALESCE(NULLIF(e.actor_display_name, ''), NULLIF(p.display_name, ''), 'Deleted member'),
       actor_email = COALESCE(e.actor_email, p.email)
  FROM profiles p
 WHERE p.user_id = e.actor_user_id
   AND (e.actor_display_name IS NULL OR e.actor_display_name = '' OR e.actor_email IS NULL);

ALTER TABLE extension_activity_events
  ALTER COLUMN actor_user_id DROP NOT NULL;

DO $$
DECLARE
  fk_name text;
BEGIN
  FOR fk_name IN
    SELECT c.conname
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid
       AND a.attnum = ANY(c.conkey)
     WHERE c.conrelid = 'extension_activity_events'::regclass
       AND c.contype = 'f'
       AND a.attname = 'actor_user_id'
  LOOP
    EXECUTE format('ALTER TABLE extension_activity_events DROP CONSTRAINT %I', fk_name);
  END LOOP;

  ALTER TABLE extension_activity_events
    ADD CONSTRAINT extension_activity_events_actor_user_id_fkey
    FOREIGN KEY (actor_user_id) REFERENCES profiles(user_id) ON DELETE SET NULL;
END $$;

CREATE OR REPLACE FUNCTION anonymize_deleted_team_member_activity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  fk record;
  child_column text;
  parent_column text;
  has_referencing_row boolean;
BEGIN
  -- Keep the extension activity timeline and reports, but remove the deleted
  -- member's personal identity from historical actor fields.
  UPDATE extension_activity_events
     SET actor_user_id = NULL,
         actor_display_name = 'Deleted member',
         actor_email = NULL
   WHERE actor_user_id = OLD.user_id;

  UPDATE audit_logs
     SET actor_user_id = CASE WHEN actor_user_id = OLD.user_id THEN NULL ELSE actor_user_id END,
         actor_email = CASE WHEN actor_user_id = OLD.user_id THEN 'Deleted member' ELSE actor_email END,
         metadata = CASE
           WHEN entity_type = 'profile' AND entity_id = OLD.user_id AND metadata ? 'email'
             THEN jsonb_set(metadata, '{email}', to_jsonb('Deleted member'::text), true)
           ELSE metadata
         END
   WHERE actor_user_id = OLD.user_id
      OR (entity_type = 'profile' AND entity_id = OLD.user_id);

  UPDATE application_comments
     SET commenter_user_id = NULL,
         commenter_name = 'Deleted member'
   WHERE commenter_user_id = OLD.user_id;

  UPDATE application_stage_history
     SET changed_by_user_id = NULL,
         changed_by_name = 'Deleted member'
   WHERE changed_by_user_id = OLD.user_id;

  UPDATE candidate_workflow_events
     SET actor_user_id = NULL,
         payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object('actor_display_name', 'Deleted member')
   WHERE actor_user_id = OLD.user_id;

  UPDATE applications
     SET assigned_by = CASE WHEN assigned_by_user_id = OLD.user_id THEN 'Deleted member' ELSE assigned_by END,
         assigned_to = CASE WHEN assigned_to_user_id = OLD.user_id THEN 'Deleted member' ELSE assigned_to END,
         assigned_by_user_id = CASE WHEN assigned_by_user_id = OLD.user_id THEN NULL ELSE assigned_by_user_id END,
         assigned_to_user_id = CASE WHEN assigned_to_user_id = OLD.user_id THEN NULL ELSE assigned_to_user_id END,
         proof_uploaded_by_user_id = CASE WHEN proof_uploaded_by_user_id = OLD.user_id THEN NULL ELSE proof_uploaded_by_user_id END,
         application_stage_changed_by_name = CASE WHEN application_stage_changed_by_user_id = OLD.user_id THEN 'Deleted member' ELSE application_stage_changed_by_name END,
         application_stage_changed_by_user_id = CASE WHEN application_stage_changed_by_user_id = OLD.user_id THEN NULL ELSE application_stage_changed_by_user_id END,
         ae_stage_updated_by_name = CASE WHEN ae_stage_updated_by_user_id = OLD.user_id THEN 'Deleted member' ELSE ae_stage_updated_by_name END,
         ae_stage_updated_by_user_id = CASE WHEN ae_stage_updated_by_user_id = OLD.user_id THEN NULL ELSE ae_stage_updated_by_user_id END,
         ae_applied_by_name = CASE WHEN ae_applied_by_user_id = OLD.user_id THEN 'Deleted member' ELSE ae_applied_by_name END,
         ae_applied_by_user_id = CASE WHEN ae_applied_by_user_id = OLD.user_id THEN NULL ELSE ae_applied_by_user_id END
   WHERE assigned_by_user_id = OLD.user_id
      OR assigned_to_user_id = OLD.user_id
      OR proof_uploaded_by_user_id = OLD.user_id
      OR application_stage_changed_by_user_id = OLD.user_id
      OR ae_stage_updated_by_user_id = OLD.user_id
      OR ae_applied_by_user_id = OLD.user_id;

  -- These review columns are present in current production schemas, while some
  -- older bootstrap schemas predate them. Keep the migration compatible with
  -- both shapes without dropping the review history when the columns exist.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'applications'
       AND column_name = 'ae_reviewed_by_user_id'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'applications'
       AND column_name = 'ae_reviewed_by_name'
  ) THEN
    EXECUTE $sql$
      UPDATE applications
         SET ae_reviewed_by_user_id = NULL,
             ae_reviewed_by_name = 'Deleted member'
       WHERE ae_reviewed_by_user_id = $1
    $sql$ USING OLD.user_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'applications'
       AND column_name = 'reviewed_by_user_id'
  ) THEN
    EXECUTE $sql$
      UPDATE applications
         SET reviewed_by_user_id = NULL
       WHERE reviewed_by_user_id = $1
    $sql$ USING OLD.user_id;
  END IF;

  -- A member-owned API key must not remain usable after account deletion.
  UPDATE extension_api_keys
     SET revoked_at = COALESCE(revoked_at, now()),
         owner_user_id = NULL,
         created_by = NULL,
         label = 'Deleted member revoked key'
   WHERE owner_user_id = OLD.user_id
      OR created_by = OLD.user_id;

  -- Clear any other optional profile references only for this deletion.
  -- Keeping their original foreign-key actions intact avoids changing runtime
  -- behavior elsewhere in the application.
  FOR fk IN
    SELECT c.conrelid, c.conname, c.conkey, c.confkey
      FROM pg_constraint c
     WHERE c.confrelid = 'profiles'::regclass
       AND c.contype = 'f'
       AND c.confdeltype IN ('a', 'r')
  LOOP
    IF array_length(fk.conkey, 1) <> 1 OR array_length(fk.confkey, 1) <> 1 THEN
      RAISE EXCEPTION 'Cannot safely remove team member: unsupported composite profile reference %', fk.conname;
    END IF;

    SELECT a.attname INTO child_column
      FROM pg_attribute a
     WHERE a.attrelid = fk.conrelid AND a.attnum = fk.conkey[1];
    SELECT a.attname INTO parent_column
      FROM pg_attribute a
     WHERE a.attrelid = 'profiles'::regclass AND a.attnum = fk.confkey[1];

    IF parent_column <> 'user_id' THEN
      RAISE EXCEPTION 'Cannot safely remove team member: unexpected profiles reference %', fk.conname;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_attribute a
       WHERE a.attrelid = fk.conrelid AND a.attname = child_column AND a.attnotnull
    ) THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)', fk.conrelid::regclass, child_column)
         INTO has_referencing_row
        USING OLD.user_id;
      IF has_referencing_row THEN
        RAISE EXCEPTION 'Cannot safely remove team member: required profile reference % must be reassigned first', fk.conname;
      END IF;
      CONTINUE;
    END IF;

    EXECUTE format('UPDATE %s SET %I = NULL WHERE %I = $1', fk.conrelid::regclass, child_column, child_column)
      USING OLD.user_id;
  END LOOP;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS profiles_anonymize_deleted_member_activity ON profiles;
CREATE TRIGGER profiles_anonymize_deleted_member_activity
BEFORE DELETE ON profiles
FOR EACH ROW
EXECUTE FUNCTION anonymize_deleted_team_member_activity();

COMMIT;
