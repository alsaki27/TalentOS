create table if not exists saved_job_searches (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  owner_user_id uuid references profiles(user_id) on delete set null,
  filters jsonb not null default '{}'::jsonb,
  is_shared boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists saved_job_searches_owner_idx
  on saved_job_searches (owner_user_id);

create index if not exists saved_job_searches_shared_idx
  on saved_job_searches (is_shared, created_at desc);

alter table public.import_sources enable row level security;
alter table public.import_runs enable row level security;
alter table public.saved_job_searches enable row level security;
