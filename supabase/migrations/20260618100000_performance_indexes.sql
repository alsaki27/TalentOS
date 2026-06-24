-- Performance indexes for the high-traffic dashboard/list endpoints.

create index if not exists jobs_created_at_desc_idx on jobs (created_at desc);
create index if not exists jobs_posted_at_desc_idx on jobs (posted_at desc);
create index if not exists jobs_posted_at_asc_idx on jobs (posted_at asc);
create index if not exists jobs_source_idx on jobs (source);
create index if not exists jobs_employment_type_idx on jobs (employment_type);
create index if not exists jobs_role_tier_idx on jobs (role_tier);
create index if not exists jobs_is_active_idx on jobs (is_active);

create index if not exists applications_status_due_applied_idx
  on applications (status, assignment_due_at, applied_at desc);

create index if not exists applications_candidate_applied_idx
  on applications (candidate_id, applied_at desc);

create index if not exists candidates_created_at_desc_idx on candidates (created_at desc);
create index if not exists resumes_candidate_created_idx on resumes (candidate_id, created_at desc);
create index if not exists import_profiles_created_at_desc_idx on import_profiles (created_at desc);
