create table if not exists job_match_scores (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  candidate_id uuid not null references candidates(id) on delete cascade,
  base_resume_id uuid references base_resumes(id) on delete cascade,
  score integer not null check (score >= 0 and score <= 100),
  breakdown jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (job_id, candidate_id)
);

create index if not exists job_match_scores_job_idx on job_match_scores (job_id);
create index if not exists job_match_scores_candidate_idx on job_match_scores (candidate_id);
