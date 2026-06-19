-- Resume tailoring workflow metadata.
-- Uses the existing application_resume_versions table for saved tailored variants.

alter table application_resume_versions
  add column if not exists title text,
  add column if not exists version_label text,
  add column if not exists generated_text text,
  add column if not exists source_resume_id uuid references base_resumes(id) on delete set null;

create index if not exists app_resume_versions_target_job_idx on application_resume_versions (target_job_id);
create index if not exists app_resume_versions_source_resume_idx on application_resume_versions (source_resume_id);
