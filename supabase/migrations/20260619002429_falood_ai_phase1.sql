-- Falood AI Phase 1 — Candidate profile extension + resume upload/parsing + evidence bank
-- Full schema for all 6 phases; only Phase 1 code is implemented now.

-- ============================================================
-- 1. CANDIDATE PROFILE EXTENSION
-- ============================================================

alter table candidates
  add column if not exists linkedin_url text,
  add column if not exists github_url text,
  add column if not exists portfolio_url text,
  add column if not exists visa_status text,
  add column if not exists target_industries text[],
  add column if not exists location_preference text,
  add column if not exists work_mode_preference text,
  add column if not exists available_start_date date;

create index if not exists candidates_target_industries_idx on candidates using gin (target_industries);

-- ============================================================
-- 2. RESUME PARSING (extend existing resumes table)
-- ============================================================

alter table resumes
  add column if not exists parsed_json jsonb,
  add column if not exists is_original_upload boolean not null default false;

-- ============================================================
-- 3. APPLICATION EXTENSION (for later phases, but schema needed now)
-- ============================================================

alter table applications
  add column if not exists submission_url text,
  add column if not exists proof_required boolean not null default false;

-- ============================================================
-- 4. CANDIDATE EVIDENCE BANK
-- ============================================================

create table if not exists candidate_evidence (
  id                uuid primary key default gen_random_uuid(),
  candidate_id      uuid not null references candidates(id) on delete cascade,
  source_type       text not null,   -- uploaded_resume | manual_note | project | github | portfolio | interview_note | work_sample
  title             text not null,
  description       text,
  related_skills    text[],
  proof_url         text,
  confidence_score  numeric default 0.7,
  created_by        uuid references profiles(user_id) on delete set null,
  created_at        timestamptz default now()
);

create index if not exists evidence_candidate_idx on candidate_evidence (candidate_id);
create index if not exists evidence_source_type_idx on candidate_evidence (source_type);

alter table candidate_evidence enable row level security;

-- ============================================================
-- 5. RESUME STYLES (data-driven formatting presets)
-- ============================================================

create table if not exists resume_styles (
  id                  text primary key,
  label               text not null,
  description         text,
  formatting_defaults jsonb not null,
  is_active           boolean not null default true
);

insert into resume_styles (id, label, description, formatting_defaults) values
  ('skarion_compact_professional', 'Skarion Compact Professional',
   'One-page, ATS-friendly, bullet-heavy, no color/photos/icons.',
   '{"pageFormat":"letter","fontFamily":"Calibri","fontSize":10.5,"marginTop":0.5,"marginRight":0.5,"marginBottom":0.5,"marginLeft":0.5,"sectionSpacing":8,"bulletSpacing":2,"lineHeight":1.15}')
  on conflict (id) do nothing;

alter table resume_styles enable row level security;

-- ============================================================
-- 6. BASE RESUMES (structured JSON resume document)
-- ============================================================

create table if not exists base_resumes (
  id              uuid primary key default gen_random_uuid(),
  candidate_id    uuid not null references candidates(id) on delete cascade,
  name            text not null,
  target_industry text,
  target_roles    text[],
  style_id        text references resume_styles(id) default 'skarion_compact_professional',
  status          text not null default 'draft',   -- draft | in_review | approved | archived
  content         jsonb not null,                  -- ResumeDocument
  created_by      uuid references profiles(user_id) on delete set null,
  updated_by      uuid references profiles(user_id) on delete set null,
  approved_by     uuid references profiles(user_id) on delete set null,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists base_resumes_candidate_idx on base_resumes (candidate_id);

alter table base_resumes enable row level security;

-- ============================================================
-- 7. TARGET JOBS (JD analysis, linked to existing jobs masterlist)
-- ============================================================

create table if not exists target_jobs (
  id                  uuid primary key default gen_random_uuid(),
  candidate_id        uuid not null references candidates(id) on delete cascade,
  job_id              uuid not null references jobs(id) on delete cascade,
  raw_description     text not null,
  parsed_description  jsonb,    -- JDAnalysis
  fit_score           numeric,
  recommendation      text,
  created_by          uuid references profiles(user_id) on delete set null,
  created_at          timestamptz default now(),
  unique (candidate_id, job_id)
);

create index if not exists target_jobs_candidate_idx on target_jobs (candidate_id);
create index if not exists target_jobs_job_idx on target_jobs (job_id);

alter table target_jobs enable row level security;

-- ============================================================
-- 8. JOB KEYWORDS (extracted from JD analysis)
-- ============================================================

create table if not exists job_keywords (
  id              uuid primary key default gen_random_uuid(),
  target_job_id   uuid not null references target_jobs(id) on delete cascade,
  keyword         text not null,
  category        text,        -- skill | tool | domain | soft_skill | certification | methodology
  importance      text,        -- low | medium | high
  source_text     text,
  created_at      timestamptz default now()
);

create index if not exists job_keywords_target_job_idx on job_keywords (target_job_id);

alter table job_keywords enable row level security;

-- ============================================================
-- 9. KEYWORD APPROVALS (human review of JD keywords)
-- ============================================================

create table if not exists keyword_approvals (
  id                  uuid primary key default gen_random_uuid(),
  keyword_id          uuid not null references job_keywords(id) on delete cascade,
  candidate_id        uuid not null references candidates(id) on delete cascade,
  base_resume_id      uuid references base_resumes(id) on delete set null,
  decision            text not null,         -- approved | rejected | needs_review | cover_letter_only | already_present
  evidence_status     text,                -- strong | medium | weak | missing
  evidence_ids        uuid[],
  notes               text,
  decided_by          uuid references profiles(user_id) on delete set null,
  decided_at          timestamptz default now()
);

create index if not exists keyword_approvals_candidate_idx on keyword_approvals (candidate_id);

alter table keyword_approvals enable row level security;

-- ============================================================
-- 10. APPLICATION RESUME VERSIONS (tailored resumes per application)
-- ============================================================

create table if not exists application_resume_versions (
  id                  uuid primary key default gen_random_uuid(),
  candidate_id        uuid not null references candidates(id) on delete cascade,
  base_resume_id      uuid references base_resumes(id) on delete set null,
  target_job_id       uuid not null references target_jobs(id) on delete cascade,
  content             jsonb not null,
  formatting          jsonb,
  ats_score           numeric,
  truth_score         numeric,
  one_page_fit_score  numeric,
  status              text not null default 'draft',  -- draft | in_review | approved | archived
  created_by          uuid references profiles(user_id) on delete set null,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create index if not exists app_resume_versions_candidate_idx on application_resume_versions (candidate_id);

alter table application_resume_versions enable row level security;

-- ============================================================
-- 11. RESUME SUGGESTIONS (AI propose-only, human must approve)
-- ============================================================

create table if not exists resume_suggestions (
  id                      uuid primary key default gen_random_uuid(),
  application_resume_id   uuid not null references application_resume_versions(id) on delete cascade,
  section_type            text,
  target_block_id         text,
  original_text           text,
  suggested_text          text,
  reason                  text,
  jd_keyword_ids          uuid[],
  evidence_ids            uuid[],
  confidence_score        numeric,
  truth_risk              text,        -- low | medium | high
  ats_impact              text,        -- low | medium | high
  status                  text not null default 'pending',  -- pending | accepted | rejected | customized
  user_instruction        text,
  created_by              text,
  created_at              timestamptz default now(),
  resolved_at             timestamptz
);

create index if not exists resume_suggestions_app_resume_idx on resume_suggestions (application_resume_id);
create index if not exists resume_suggestions_status_idx on resume_suggestions (status);

alter table resume_suggestions enable row level security;

-- ============================================================
-- 12. APPLICATION PACKETS (1:1 companion to applications)
-- ============================================================

create table if not exists application_packets (
  application_id            uuid primary key references applications(id) on delete cascade,
  base_resume_id            uuid references base_resumes(id) on delete set null,
  target_job_id             uuid references target_jobs(id) on delete set null,
  final_resume_version_id   uuid references application_resume_versions(id) on delete set null,
  approved_keyword_ids      uuid[],
  rejected_keyword_ids      uuid[],
  cover_letter              text,
  recruiter_message         text,
  hiring_manager_email      text,
  interview_prep_notes      text,
  created_by                uuid references profiles(user_id) on delete set null,
  created_at                timestamptz default now()
);

alter table application_packets enable row level security;

-- ============================================================
-- 13. APPLICATION PROOFS (submission screenshots)
-- ============================================================

create table if not exists application_proofs (
  id            uuid primary key default gen_random_uuid(),
  application_id uuid not null references applications(id) on delete cascade,
  file_url      text not null,
  file_type     text,
  uploaded_by   uuid references profiles(user_id) on delete set null,
  notes         text,
  uploaded_at   timestamptz default now()
);

create index if not exists application_proofs_app_idx on application_proofs (application_id);

alter table application_proofs enable row level security;

-- ============================================================
-- 14. FALOOD CONVERSATIONS (mirrors chat_conversations)
-- ============================================================

create table if not exists falood_conversations (
  id                  uuid primary key default gen_random_uuid(),
  mode                text not null,  -- candidate_profile_setup | base_resume_creation | application_resume_tailoring | pdf_preview_adjustment
  candidate_id        uuid references candidates(id) on delete cascade,
  base_resume_id      uuid references base_resumes(id) on delete set null,
  application_resume_id uuid references application_resume_versions(id) on delete set null,
  user_id             uuid references profiles(user_id) on delete set null,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create index if not exists falood_conv_candidate_idx on falood_conversations (candidate_id);
create index if not exists falood_conv_mode_idx on falood_conversations (mode);

alter table falood_conversations enable row level security;

-- ============================================================
-- 15. FALOOD MESSAGES (mirrors chat_messages)
-- ============================================================

create table if not exists falood_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references falood_conversations(id) on delete cascade,
  role            text check (role in ('user','assistant','action')),
  content         text,
  command         text,
  action_json     jsonb,
  created_at      timestamptz default now()
);

create index if not exists falood_messages_conv_idx on falood_messages (conversation_id, created_at);

alter table falood_messages enable row level security;

-- ============================================================
-- 16. REVIEWER ROLE (auth profiles)
-- ============================================================

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('admin','manager','application_engineer','recruiter','reviewer'));
