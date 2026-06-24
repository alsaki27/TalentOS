-- V1 expansion: richer candidate profiles, resume variants, job freshness,
-- application follow-ups + status timeline.

alter table candidates
  add column if not exists target_roles text,
  add column if not exists preferred_locations text,
  add column if not exists salary_expectation text,
  add column if not exists work_authorization text;

alter table jobs
  add column if not exists last_seen_at timestamptz default now();

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

alter table applications
  add column if not exists follow_up_at date,
  add column if not exists next_action text,
  add column if not exists resume_id uuid references resumes(id) on delete set null;

create index if not exists applications_follow_up_idx on applications (follow_up_at);

create table if not exists application_events (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references applications(id) on delete cascade,
  from_status     text,
  to_status       text not null,
  note            text,
  created_at      timestamptz default now()
);
create index if not exists application_events_application_idx on application_events (application_id);
