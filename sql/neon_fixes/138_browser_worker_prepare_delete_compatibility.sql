-- Keep existing source deletion paths available after an application is enrolled.
-- Staff UUIDs remain audit snapshots after a team member is deleted.
BEGIN;

ALTER TABLE browser_worker_prepare_runs
  DROP CONSTRAINT IF EXISTS browser_worker_prepare_runs_enrollment_id_fkey,
  ADD CONSTRAINT browser_worker_prepare_runs_enrollment_id_fkey
    FOREIGN KEY (enrollment_id) REFERENCES browser_worker_prepare_enrollments(id) ON DELETE CASCADE;

ALTER TABLE browser_worker_prepare_enrollments
  DROP CONSTRAINT IF EXISTS browser_worker_prepare_enrollments_application_id_fkey,
  DROP CONSTRAINT IF EXISTS browser_worker_prepare_enrollments_candidate_id_fkey,
  DROP CONSTRAINT IF EXISTS browser_worker_prepare_enrollments_job_id_fkey,
  DROP CONSTRAINT IF EXISTS browser_worker_prepare_enrollments_export_id_fkey,
  DROP CONSTRAINT IF EXISTS browser_worker_prepare_enrollments_resume_version_id_fkey,
  DROP CONSTRAINT IF EXISTS browser_worker_prepare_enrollments_created_by_fkey,
  DROP CONSTRAINT IF EXISTS browser_worker_prepare_enrollments_revoked_by_fkey,
  ADD CONSTRAINT browser_worker_prepare_enrollments_application_id_fkey
    FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE,
  ADD CONSTRAINT browser_worker_prepare_enrollments_candidate_id_fkey
    FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
  ADD CONSTRAINT browser_worker_prepare_enrollments_job_id_fkey
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  ADD CONSTRAINT browser_worker_prepare_enrollments_export_id_fkey
    FOREIGN KEY (export_id) REFERENCES application_resume_exports(id) ON DELETE CASCADE,
  ADD CONSTRAINT browser_worker_prepare_enrollments_resume_version_id_fkey
    FOREIGN KEY (resume_version_id) REFERENCES application_resume_versions(id) ON DELETE CASCADE;

COMMIT;
