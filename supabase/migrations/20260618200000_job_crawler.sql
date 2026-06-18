-- Live job crawler ingestion + real-time push. Ported as an idea (not code) from
-- comparing against the team's skarion-api repo: an external crawler bot pushes jobs
-- into this app over an API-key-gated endpoint and reports a heartbeat, instead of this
-- app pulling on a cron schedule. Real-time push uses Supabase Realtime (already part of
-- @supabase/supabase-js, no new dependency) instead of their separate Socket.IO server,
-- since this app has no persistent server process to host a websocket server on.

create table if not exists job_crawler_status (
  id                          uuid primary key default gen_random_uuid(),
  crawler_name                text not null unique,
  is_active                   boolean not null default true,
  last_heartbeat_at           timestamptz,
  offline_threshold_minutes   integer not null default 10,
  message                     text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

alter table public.job_crawler_status enable row level security;

-- Real-time push: add jobs + job_crawler_status to the Realtime publication if it
-- exists on this project (it does on every standard Supabase project; guarded here in
-- case of a self-hosted setup without it, so this migration never hard-fails on that).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'jobs'
    ) then
      alter publication supabase_realtime add table public.jobs;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'job_crawler_status'
    ) then
      alter publication supabase_realtime add table public.job_crawler_status;
    end if;
  end if;
end $$;
