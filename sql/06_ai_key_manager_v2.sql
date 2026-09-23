-- AI Key Manager v2: many-to-many routing + real usage tracking.
-- Replaces the 1-row-per-category model with 1-row-per-automation, ordered fallback chains.
-- All statements are idempotent (CREATE IF NOT EXISTS, ADD COLUMN IF NOT EXISTS).

-- ── ai_automations ──
create table if not exists ai_automations (
  id            text primary key,             -- stable slug, e.g. 'resume_parsing', 'jd_analysis'
  label         text not null,                 -- human label for the UI
  description   text not null,
  group_label   text not null,                 -- UI grouping: 'Parsing & Extraction', 'Resume Studio', etc (cosmetic only)
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ── ai_automation_routes (ordered fallback chain per automation) ──
create table if not exists ai_automation_routes (
  id             uuid primary key default gen_random_uuid(),
  automation_id  text not null references ai_automations(id) on delete cascade,
  ai_key_id      uuid references ai_api_keys(id) on delete cascade,
  provider       text,
  rank           int not null,
  is_enabled     boolean not null default true,
  updated_at     timestamptz not null default now(),
  updated_by     uuid references profiles(user_id),
  unique (automation_id, rank),
  check (ai_key_id is not null or provider is not null)
);
create index if not exists aar_automation_idx on ai_automation_routes (automation_id, rank);
create index if not exists aar_key_idx on ai_automation_routes (ai_key_id);

-- ── ai_usage_events (every real AI call, not just manual "Test key" clicks) ──
create table if not exists ai_usage_events (
  id             uuid primary key default gen_random_uuid(),
  automation_id  text not null references ai_automations(id),
  ai_key_id      uuid references ai_api_keys(id) on delete set null,
  provider       text not null,
  model          text,
  outcome        text not null check (outcome in ('success','failure','timeout')),
  latency_ms     int,
  input_tokens   int,
  output_tokens  int,
  estimated_cost_usd numeric(10,5),
  error_message  text,
  triggered_by_user_id uuid references profiles(user_id),
  created_at     timestamptz not null default now()
);
create index if not exists aue_automation_time_idx on ai_usage_events (automation_id, created_at desc);
create index if not exists aue_key_time_idx on ai_usage_events (ai_key_id, created_at desc);
create index if not exists aue_created_idx on ai_usage_events (created_at desc);

-- ── ai_usage_daily (daily rollups) ──
-- ai_key_id is intentionally NOT in the primary key: callWithUsageTracking passes
-- null when a route resolves via bare provider name or the global env chain (the
-- default state for every automation with no routes configured). Putting ai_key_id
-- in the PK would make it implicitly NOT NULL and crash the first rollup cron run
-- against real data. A nullable ai_key_id with a per-provider PK allows one rollup
-- row per automation+provider+day regardless of which specific key served the call.
create table if not exists ai_usage_daily (
  usage_date     date not null,
  automation_id  text not null references ai_automations(id),
  ai_key_id      uuid references ai_api_keys(id) on delete set null,
  provider       text not null,
  call_count     int not null default 0,
  success_count  int not null default 0,
  failure_count  int not null default 0,
  total_input_tokens int not null default 0,
  total_output_tokens int not null default 0,
  total_cost_usd numeric(10,5) not null default 0,
  avg_latency_ms int,
  primary key (usage_date, automation_id, provider)
);

-- ── Seed ai_automations (one row per real call site) ──
insert into ai_automations (id, label, description, group_label) values
  ('resume_parsing',        'Resume Parsing',            'Extract structured fields from uploaded PDF/DOCX resumes', 'Parsing & Extraction'),
  ('candidate_markitdown',  'Candidate Doc Import',       'Parse candidate profile docs via markitdown',              'Parsing & Extraction'),
  ('jd_analysis',           'JD Analysis',                'Extract structured requirements from job descriptions',    'Parsing & Extraction'),
  ('job_categorization',    'Job Categorization',         'Auto-categorize imported jobs',                            'Parsing & Extraction'),
  ('keyword_extraction',    'Application Keywords',       'Generate JD keywords for an application',                  'Parsing & Extraction'),
  ('evidence_mapping',      'Evidence Mapping',           'AI-assisted fallback for mapping keywords to evidence',    'Parsing & Extraction'),
  ('target_jobs_matching',  'Target Jobs Matching',       'Match candidate profile to target job criteria',           'Parsing & Extraction'),
  ('base_resume_studio',    'Base Resume Studio',         'CLI-style base resume editing commands',                   'Resume Studio'),
  ('application_tailoring', 'Application Tailoring',      'Tailor resume content to a specific application',          'Resume Studio'),
  ('resume_suggestions',    'Resume Suggestions',         'Suggest resume improvements from approved keywords',       'Resume Studio'),
  ('cover_letter_gen',      'Cover Letter Generation',    'Generate cover letters',                                   'Content Generation'),
  ('recruiter_message_gen', 'Recruiter Message Generation','Generate recruiter outreach messages',                    'Content Generation'),
  ('ai_digest',             'Daily/Weekly Digest',        'Summarize pipeline activity',                              'Content Generation'),
  ('chat_assistant',        'Chat Assistant',             'Interactive assistant with read-only data tools',          'Assistant')
on conflict (id) do nothing;
