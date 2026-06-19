-- Chunk 1: Application workflow redesign — database foundation
-- Makes applications.job_id nullable, adds ad-hoc job support, AI-extracted metadata on jobs,
-- and resume source tracking on application_resume_versions.
-- Backward compatible: existing data and workflows continue working unchanged.

-- ============================================================
-- 1. APPLICATIONS TABLE
-- ============================================================

-- Drop the unique constraint that prevents multiple applications per candidate.
-- For ad-hoc applications, a candidate may have multiple apps with no linked job.
alter table applications
  drop constraint if exists applications_candidate_id_job_id_key;

-- Make job_id nullable so applications can be created without a masterlist job.
alter table applications
  alter column job_id drop not null;

-- Add fields for ad-hoc job support (pasted JD, AI-extracted metadata inline).
alter table applications
  add column if not exists adhoc_job_data jsonb,
  add column if not exists adhoc_job_raw_text text,
  add column if not exists source_type text default 'base_resume';

-- Add check constraint for source_type values.
-- Only add if not already present (idempotent).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'applications_source_type_check'
    and conrelid = 'applications'::regclass
  ) then
    alter table applications
      add constraint applications_source_type_check
      check (source_type in ('base_resume', 'original_resume', 'blank', 'manual'));
  end if;
end $$;

-- Index for filtering by source_type (useful for dashboards/reports).
create index if not exists applications_source_type_idx on applications (source_type);

-- ============================================================
-- 2. JOBS TABLE (masterlist)
-- ============================================================

-- Add fields for AI-extracted metadata from pasted JDs.
-- jobs.source already exists; we add new fields for the AI pipeline.
alter table jobs
  add column if not exists raw_description text,
  add column if not exists parsed_description jsonb,
  add column if not exists ai_extracted_at timestamptz,
  add column if not exists ai_confidence_score numeric;

-- Check constraint: ai_confidence_score is null or between 0 and 1.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'jobs_ai_confidence_score_check'
    and conrelid = 'jobs'::regclass
  ) then
    alter table jobs
      add constraint jobs_ai_confidence_score_check
      check (ai_confidence_score is null or (ai_confidence_score >= 0 and ai_confidence_score <= 1));
  end if;
end $$;

-- Indexes for JD deduplication and AI-enrichment queries.
-- company + title composite for fuzzy dedupe lookups.
create index if not exists jobs_company_title_idx on jobs (company, title);
-- ai_extracted_at partial index for listing AI-extracted jobs.
create index if not exists jobs_ai_extracted_at_idx on jobs (ai_extracted_at) where ai_extracted_at is not null;

-- ============================================================
-- 3. APPLICATION_RESUME_VERSIONS TABLE
-- ============================================================

-- Add source_type to track whether the resume was built from a base resume,
-- the candidate's original upload, a blank template, or manual entry.
alter table application_resume_versions
  add column if not exists source_type text default 'base_resume';

-- Check constraint for source_type values.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'app_resume_versions_source_type_check'
    and conrelid = 'application_resume_versions'::regclass
  ) then
    alter table application_resume_versions
      add constraint app_resume_versions_source_type_check
      check (source_type in ('base_resume', 'original_resume', 'blank', 'manual'));
  end if;
end $$;

-- Index for filtering by resume source.
create index if not exists app_resume_versions_source_type_idx on application_resume_versions (source_type);

-- ============================================================
-- 4. JOB_DUPLICATES TABLE (optional, for future deduplication engine)
-- ============================================================

-- Tracks potential duplicate jobs so the AI deduplication engine can resolve them later.
-- Kept minimal to avoid overcomplicating the current schema.
create table if not exists job_duplicates (
  id                uuid primary key default gen_random_uuid(),
  canonical_job_id  uuid not null references jobs(id) on delete cascade,
  duplicate_job_id  uuid not null references jobs(id) on delete cascade,
  similarity_score  numeric not null,
  resolved          boolean not null default false,
  created_at        timestamptz default now(),
  unique (canonical_job_id, duplicate_job_id)
);

create index if not exists job_duplicates_canonical_idx on job_duplicates (canonical_job_id);
create index if not exists job_duplicates_duplicate_idx on job_duplicates (duplicate_job_id);

-- ============================================================
-- 5. BACKWARD COMPATIBILITY: keep existing unique constraint for job-linked apps
-- ============================================================

-- Re-add a partial unique constraint: only enforce uniqueness when job_id IS NOT NULL.
-- This preserves the "no duplicate (candidate, job) pairs" rule for masterlist jobs
-- while allowing unlimited ad-hoc applications per candidate.
create unique index if not exists applications_candidate_job_unique_when_not_null
  on applications (candidate_id, job_id)
  where job_id is not null;
