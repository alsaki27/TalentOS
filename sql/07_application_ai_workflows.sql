-- Multi-agent application pipeline: workflow, stage run, artifact, and agent config tables.
-- All statements are idempotent (CREATE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS).

-- ── application_ai_workflows ──
create table if not exists application_ai_workflows (
  id               uuid primary key default gen_random_uuid(),
  application_id   uuid not null references applications(id) on delete cascade,
  base_resume_id   uuid references application_resume_versions(id) on delete set null,
  status           text not null default 'queued'
    check (status in ('queued','running','waiting','failed','cancelled','completed')),
  current_stage    int not null default 0,
  idempotency_key  text,
  config_snapshot  jsonb,
  started_by       uuid references profiles(user_id),
  started_at       timestamptz,
  completed_at     timestamptz,
  cancelled_at     timestamptz,
  last_error       text,
  created_at       timestamptz not null default now()
);
create index if not exists aaw_application_idx on application_ai_workflows (application_id);
create index if not exists aaw_status_idx on application_ai_workflows (status);
create unique index if not exists aaw_idempotency_idx on application_ai_workflows (idempotency_key)
  where idempotency_key is not null;

-- ── application_ai_stage_runs ──
create table if not exists application_ai_stage_runs (
  id                 uuid primary key default gen_random_uuid(),
  workflow_id        uuid not null references application_ai_workflows(id) on delete cascade,
  automation_id      text not null,
  sequence_number    int not null,
  attempt_number     int not null default 1,
  status             text not null default 'pending'
    check (status in ('pending','running','success','failed','skipped','cancelled')),
  provider           text,
  model              text,
  ai_key_id          uuid,
  prompt_version     text,
  input_artifact_id  uuid,
  output_artifact_id uuid,
  input_tokens       int,
  output_tokens      int,
  estimated_cost_usd numeric(10,5),
  latency_ms         int,
  error_code         text,
  error_message      text,
  started_at         timestamptz,
  completed_at       timestamptz,
  unique (workflow_id, sequence_number, attempt_number)
);
create index if not exists aasr_workflow_idx on application_ai_stage_runs (workflow_id, sequence_number);
create index if not exists aasr_status_idx on application_ai_stage_runs (status)
  where status = 'pending';

-- ── application_ai_artifacts ──
create table if not exists application_ai_artifacts (
  id               uuid primary key default gen_random_uuid(),
  workflow_id      uuid not null references application_ai_workflows(id) on delete cascade,
  automation_id    text not null,
  sequence_number  int not null,
  schema_version   text not null,
  content_hash     text not null,
  data             jsonb not null,
  created_at       timestamptz not null default now()
);
create index if not exists aaa_workflow_idx on application_ai_artifacts (workflow_id, sequence_number);

-- ── ai_agent_configs ──
create table if not exists ai_agent_configs (
  automation_id        text primary key,
  display_name         text not null,
  system_prompt        text,
  prompt_version       text,
  output_schema_version text,
  temperature          numeric(3,2) default 0.2,
  max_output_tokens    int default 2048,
  timeout_ms           int default 30000,
  max_attempts         int default 2,
  approval_policy      text not null default 'auto'
    check (approval_policy in ('auto','risk_based','always_human')),
  minimum_score        numeric(3,1) default 0,
  is_active            boolean not null default true,
  updated_by           uuid references profiles(user_id),
  updated_at           timestamptz not null default now()
);

-- Seed agent configs
insert into ai_agent_configs (automation_id, display_name, system_prompt, prompt_version, output_schema_version, temperature, max_output_tokens, timeout_ms, max_attempts, approval_policy, minimum_score) values
  ('application_job_lens',     'Job Lens',     null, null, 'JobAnalysisV1',   0.2, 2048, 30000, 2, 'auto',       0),
  ('application_resume_forge', 'Resume Forge', null, null, 'ResumeDraftV1',   0.3, 4096, 60000, 2, 'risk_based', 0),
  ('application_hiring_panel', 'Hiring Panel', null, null, 'ReviewScoreV1',   0.1, 2048, 30000, 2, 'auto',       6.0),
  ('application_final_polish', 'Final Polish', null, null, 'FinalResumeV1',   0.2, 4096, 60000, 2, 'auto',       0)
on conflict (automation_id) do nothing;
