-- Historical log of every scheduled/manual import run, not just the most recent
-- (import_sources.last_result only ever holds the latest outcome).

create table if not exists import_runs (
  id              uuid primary key default gen_random_uuid(),
  import_source_id uuid not null references import_sources(id) on delete cascade,
  imported        integer,
  skipped         integer,
  error           text,
  ran_at          timestamptz not null default now()
);

create index if not exists import_runs_source_idx on import_runs (import_source_id, ran_at desc);
