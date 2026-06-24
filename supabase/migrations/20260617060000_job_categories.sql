-- Job categorization fields. These are heuristic-filled today and can be rescored later.

alter table jobs
  add column if not exists job_category text,
  add column if not exists category_tags text[] default '{}',
  add column if not exists category_relevance_score integer;

create index if not exists jobs_job_category_idx on jobs (job_category);
create index if not exists jobs_category_tags_idx on jobs using gin (category_tags);
