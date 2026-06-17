-- ============================================================
-- SKARION APP — Candidates + Jobs + Applications
-- Run in Supabase SQL editor.
-- ============================================================

create extension if not exists pgcrypto; -- for gen_random_uuid()

-- ----- CANDIDATES -----
create table if not exists candidates (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  email                 text,
  phone                 text,
  status                text default 'active',        -- active | placed | paused | dropped
  target_tier           text,                          -- osp | adjacent_1 | adjacent_2 | null
  notes                 text,
  resume_url            text,                          -- Supabase Storage path to current resume
  resume_filename       text,
  target_roles          text,
  preferred_locations   text,
  salary_expectation    text,
  work_authorization    text,
  avatar_url            text,
  created_at            timestamptz default now()
);

-- ----- JOBS (masterlist) -----
create table if not exists jobs (
  id                       uuid primary key default gen_random_uuid(),
  title                    text not null,
  company                  text,
  location                 text,
  source                   text,                        -- 'manual' | 'csv_import' | 'linkedin' | 'greenhouse' | 'lever' | 'ashby'
  role_tier                text,                        -- osp | adjacent_1 | adjacent_2 | null
  salary_range             text,
  source_url               text,
  notes                    text,
  is_active                boolean default true,
  seniority_level          text,                        -- LinkedIn: seniorityLevel
  employment_type          text,                        -- LinkedIn: employmentType
  applicants_count         integer,                     -- LinkedIn: applicantsCount
  company_employees_count  integer,                     -- LinkedIn: companyEmployeesCount
  company_website          text,                        -- LinkedIn: companyWebsite
  posted_at                date,                        -- LinkedIn: postedAt
  external_job_id          text,                        -- LinkedIn: id
  tracking_id              text,                        -- LinkedIn: trackingId
  ref_id                   text,                        -- LinkedIn: refId
  apply_url                text,                        -- LinkedIn: applyUrl
  description_html         text,                        -- LinkedIn: descriptionHtml
  description_text         text,                        -- LinkedIn: descriptionText
  benefits                 jsonb,                       -- LinkedIn: benefits
  job_function             text,                        -- LinkedIn: jobFunction
  industries               text,                        -- LinkedIn: industries
  input_url                text,                        -- LinkedIn: inputUrl
  company_linkedin_url     text,                        -- LinkedIn: companyLinkedinUrl
  company_logo_url         text,                        -- LinkedIn: companyLogo
  company_address          jsonb,                       -- LinkedIn: companyAddress
  company_slogan           text,                        -- LinkedIn: companySlogan
  company_description      text,                        -- LinkedIn: companyDescription
  job_poster_name          text,                        -- LinkedIn: jobPosterName
  job_poster_title         text,                        -- LinkedIn: jobPosterTitle
  job_poster_profile_url   text,                        -- LinkedIn: jobPosterProfileUrl
  job_poster_photo_url     text,                        -- LinkedIn: jobPosterPhoto
  raw_source_payload       jsonb,                       -- Original scraper row
  job_category             text,                        -- Primary heuristic category (OSP, Drafting, GIS, Civil, etc.)
  category_tags            text[] default '{}',         -- All matched heuristic categories
  category_relevance_score integer,                     -- 0-100 heuristic score, can be rescored later
  last_seen_at             timestamptz default now(),   -- bumped each time re-import sees this job again
  created_at               timestamptz default now()
);

create index if not exists jobs_company_idx on jobs (company);
create index if not exists jobs_tier_idx on jobs (role_tier);
create index if not exists jobs_active_idx on jobs (is_active);
create index if not exists jobs_external_job_id_idx on jobs (external_job_id);
create index if not exists jobs_job_category_idx on jobs (job_category);
create index if not exists jobs_category_tags_idx on jobs using gin (category_tags);

-- ----- JOB_COMMENTS (internal comments on each job, newest first in UI) -----
create table if not exists job_comments (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references jobs(id) on delete cascade,
  commenter_name  text not null,
  body            text not null,
  created_at      timestamptz default now()
);
create index if not exists job_comments_job_created_idx on job_comments (job_id, created_at desc);

-- ----- RESUMES (variants: multiple resumes/cover letters per candidate) -----
create table if not exists resumes (
  id            uuid primary key default gen_random_uuid(),
  candidate_id  uuid not null references candidates(id) on delete cascade,
  label         text not null,
  kind          text default 'resume',      -- resume | cover_letter
  file_url      text not null,
  filename      text not null,
  created_at    timestamptz default now()
);
create index if not exists resumes_candidate_idx on resumes (candidate_id);

-- ----- IMPORT_PROFILES (remembered column mappings for the universal import normalizer) -----
create table if not exists import_profiles (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  column_map  jsonb not null,
  created_at  timestamptz default now()
);

-- ----- APPLICATIONS (links candidate <-> job) -----
create table if not exists applications (
  id            uuid primary key default gen_random_uuid(),
  candidate_id  uuid not null references candidates(id) on delete cascade,
  job_id        uuid not null references jobs(id) on delete cascade,
  status        text default 'applied',       -- applied | replied | interview | rejected | offer | withdrawn
  resume_url    text,                          -- snapshot of which resume was used for THIS application
  resume_filename text,
  resume_id     uuid references resumes(id) on delete set null,
  follow_up_at  date,
  next_action   text,
  assigned_by   text,
  assigned_to   text,
  assignment_note text,
  assignment_due_at date,
  completed_at  timestamptz,
  applied_at    timestamptz default now(),
  notes         text,
  unique (candidate_id, job_id)                -- prevent duplicate application rows for same pair
);

create index if not exists applications_candidate_idx on applications (candidate_id);
create index if not exists applications_job_idx on applications (job_id);
create index if not exists applications_status_idx on applications (status);
create index if not exists applications_follow_up_idx on applications (follow_up_at);
create index if not exists applications_assigned_to_idx on applications (assigned_to);
create index if not exists applications_assignment_due_idx on applications (assignment_due_at);

-- ----- APPLICATION_EVENTS (status-change timeline) -----
create table if not exists application_events (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references applications(id) on delete cascade,
  from_status     text,
  to_status       text not null,
  note            text,
  created_at      timestamptz default now()
);
create index if not exists application_events_application_idx on application_events (application_id);

-- ----- Storage bucket for resumes -----
-- Run this separately if it errors (bucket may need creating via Supabase dashboard UI instead):
insert into storage.buckets (id, name, public) values ('resumes', 'resumes', true)
on conflict (id) do nothing;
