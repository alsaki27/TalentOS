alter table applications
  add column if not exists follow_up_source text,
  add column if not exists follow_up_created_at timestamptz,
  add column if not exists follow_up_completed_at timestamptz;

create index if not exists applications_follow_up_source_idx
  on applications (follow_up_source);
