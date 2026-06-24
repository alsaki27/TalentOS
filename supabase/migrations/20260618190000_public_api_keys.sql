create table if not exists public_api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  key_prefix text not null,
  key_hash text not null unique,
  scopes text[] not null default '{}',
  created_by_user_id uuid references profiles(user_id) on delete set null,
  created_by_email text,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists public_api_keys_prefix_idx on public_api_keys (key_prefix);
create index if not exists public_api_keys_revoked_idx on public_api_keys (revoked_at);
create index if not exists public_api_keys_scopes_idx on public_api_keys using gin (scopes);

alter table public.public_api_keys enable row level security;

alter table integration_events
  add column if not exists acknowledged_at timestamptz,
  add column if not exists acknowledged_by text,
  add column if not exists acknowledgement_note text;

create index if not exists integration_events_ack_idx
  on integration_events (acknowledged_at, created_at desc);
