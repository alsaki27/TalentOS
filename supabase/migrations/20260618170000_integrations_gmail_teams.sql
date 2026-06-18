create table if not exists integration_oauth_states (
  state text primary key,
  provider text not null check (provider in ('gmail')),
  owner_type text not null check (owner_type in ('profile', 'candidate', 'shared_application_mailbox')),
  owner_user_id uuid references profiles(user_id) on delete cascade,
  candidate_id uuid references candidates(id) on delete cascade,
  redirect_after text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists integration_oauth_states_expires_idx
  on integration_oauth_states (expires_at);

create table if not exists integration_accounts (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('gmail')),
  owner_type text not null check (owner_type in ('profile', 'candidate', 'shared_application_mailbox')),
  owner_user_id uuid references profiles(user_id) on delete cascade,
  candidate_id uuid references candidates(id) on delete cascade,
  email text,
  scopes text[] not null default '{}',
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  status text not null default 'active' check (status in ('active', 'revoked', 'error')),
  metadata jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists integration_accounts_provider_owner_idx
  on integration_accounts (provider, owner_type, owner_user_id, candidate_id);

create unique index if not exists integration_accounts_gmail_profile_unique_idx
  on integration_accounts (provider, owner_user_id)
  where provider = 'gmail' and owner_type = 'profile' and owner_user_id is not null;

create unique index if not exists integration_accounts_gmail_candidate_unique_idx
  on integration_accounts (provider, candidate_id)
  where provider = 'gmail' and owner_type = 'candidate' and candidate_id is not null;

create unique index if not exists integration_accounts_gmail_shared_unique_idx
  on integration_accounts (provider, owner_type)
  where provider = 'gmail' and owner_type = 'shared_application_mailbox';

create table if not exists integration_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  event_type text not null,
  external_id text,
  title text,
  message text,
  severity text not null default 'info' check (severity in ('info', 'success', 'warning', 'error')),
  payload jsonb not null default '{}'::jsonb,
  delivery_status text not null default 'received' check (delivery_status in ('received', 'sent', 'failed')),
  delivery_error text,
  created_at timestamptz not null default now()
);

create index if not exists integration_events_source_created_idx
  on integration_events (source, created_at desc);

create index if not exists integration_events_external_idx
  on integration_events (source, external_id);

alter table public.integration_oauth_states enable row level security;
alter table public.integration_accounts enable row level security;
alter table public.integration_events enable row level security;
