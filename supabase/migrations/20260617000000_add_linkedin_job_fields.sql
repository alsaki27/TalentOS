-- Add LinkedIn-sourced fields to jobs table
alter table jobs
  add column if not exists seniority_level         text,
  add column if not exists employment_type         text,
  add column if not exists applicants_count        integer,
  add column if not exists company_employees_count integer,
  add column if not exists company_website         text,
  add column if not exists posted_at               date;
