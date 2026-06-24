-- Saved, schedulable job-board sources for the ATS/career-page importers — the
-- "scheduled ingestion" gap: until now, every import was a manual button click.

create table if not exists import_sources (
  id            uuid primary key default gen_random_uuid(),
  label         text not null,
  provider      text not null check (provider in ('greenhouse', 'lever', 'ashby', 'usajobs', 'career_page')),
  token_or_url  text not null,          -- board slug/token for ATS providers, full URL for career_page
  is_active     boolean not null default true,
  last_run_at   timestamptz,
  last_result   jsonb,                  -- { imported, skipped } or { error }
  created_at    timestamptz not null default now()
);

create index if not exists import_sources_active_idx on import_sources (is_active);
