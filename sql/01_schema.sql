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
  last_seen_at             timestamptz default now(),   -- bumped each time re-import sees this job again
  created_at               timestamptz default now()
);

create index if not exists jobs_company_idx on jobs (company);
create index if not exists jobs_tier_idx on jobs (role_tier);
create index if not exists jobs_active_idx on jobs (is_active);

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
  applied_at    timestamptz default now(),
  notes         text,
  unique (candidate_id, job_id)                -- prevent duplicate application rows for same pair
);

create index if not exists applications_candidate_idx on applications (candidate_id);
create index if not exists applications_job_idx on applications (job_id);
create index if not exists applications_status_idx on applications (status);
create index if not exists applications_follow_up_idx on applications (follow_up_at);

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
