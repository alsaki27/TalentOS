-- Internal per-job comment timeline.
-- Auth is not implemented yet, so commenter_name is stored directly.

create table if not exists job_comments (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references jobs(id) on delete cascade,
  commenter_name  text not null,
  body            text not null,
  created_at      timestamptz default now()
);

create index if not exists job_comments_job_created_idx on job_comments (job_id, created_at desc);
