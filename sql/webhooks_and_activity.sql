create table if not exists webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  org_id text,
  name text not null,
  url text not null,
  secret text,
  events text[] default '{}',
  status text default 'active',
  last_delivered_at timestamptz,
  last_failure_at timestamptz,
  failure_count integer default 0,
  created_at timestamptz default now()
);

create table if not exists webhook_events (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid references webhook_endpoints(id),
  event_type text not null,
  payload jsonb not null,
  response_status integer,
  response_body text,
  attempt_count integer default 1,
  max_attempts integer default 5,
  delivered_at timestamptz,
  failed_at timestamptz,
  error_message text,
  created_at timestamptz default now()
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  type text default 'info',
  title text not null,
  body text,
  link text,
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists notifications_user_idx on notifications (user_id);
create index if not exists notifications_read_idx on notifications (read_at);

create table if not exists activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id text,
  actor_name text,
  actor_type text default 'user',
  type text not null,
  description text not null,
  entity_type text,
  entity_id uuid,
  entity_name text,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

create index if not exists activity_logs_type_idx on activity_logs (type);
create index if not exists activity_logs_entity_idx on activity_logs (entity_type, entity_id);

create index if not exists webhook_endpoints_status_idx on webhook_endpoints (status);
create index if not exists webhook_events_endpoint_idx on webhook_events (endpoint_id);
