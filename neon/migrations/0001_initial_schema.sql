
-- Neon-compatible consolidated schema for TalentOS
-- Generated from supabase/migrations/*
-- NOTE: auth.users FK references are removed; Supabase Auth is kept temporarily
--       as a hybrid auth provider. See docs/neon-safe-migration-runbook.md

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- TABLE: profiles
-- ============================================================
CREATE TABLE profiles (
  user_id       uuid PRIMARY KEY,
  -- user_id maps to Supabase Auth user ID; kept for hybrid auth compatibility
  email         text,
  display_name  text NOT NULL DEFAULT '',
  role          text NOT NULL DEFAULT 'recruiter'
    CHECK (role IN ('admin', 'manager', 'application_engineer', 'recruiter', 'reviewer')),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX profiles_role_idx ON profiles (role);
CREATE INDEX profiles_active_idx ON profiles (is_active);

-- ============================================================
-- TABLE: candidates
-- ============================================================
CREATE TABLE candidates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  email                 text,
  phone                 text,
  status                text DEFAULT 'active',
  target_tier           text,
  notes                 text,
  resume_url            text,
  resume_filename       text,
  target_roles          text,
  preferred_locations   text,
  salary_expectation    text,
  work_authorization    text,
  avatar_url            text,
  linkedin_url          text,
  github_url            text,
  portfolio_url         text,
  visa_status           text,
  target_industries     text[],
  location_preference   text,
  work_mode_preference  text,
  available_start_date  date,
  gender                text,
  ethnicity             text,
  country               text,
  city                  text,
  portal_token          uuid NOT NULL DEFAULT gen_random_uuid(),
  portal_token_expires_at   timestamptz,
  portal_token_revoked_at   timestamptz,
  updated_by            text,
  created_at            timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX candidates_portal_token_idx ON candidates (portal_token);
CREATE INDEX candidates_portal_token_expiry_idx ON candidates (portal_token_expires_at);
CREATE INDEX candidates_target_industries_idx ON candidates USING gin (target_industries);
CREATE INDEX candidates_created_at_desc_idx ON candidates (created_at desc);

-- ============================================================
-- TABLE: companies
-- ============================================================
CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  normalized_name text NOT NULL UNIQUE,
  slug text,
  website text,
  linkedin_url text,
  logo_url text,
  employees_count integer,
  address jsonb,
  slogan text,
  description text,
  notes text,
  source text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX companies_name_idx ON companies (name);
CREATE INDEX companies_last_seen_idx ON companies (last_seen_at desc);

-- ============================================================
-- TABLE: company_people
-- ============================================================
CREATE TABLE company_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  normalized_name text NOT NULL,
  title text,
  linkedin_url text,
  photo_url text,
  email text,
  phone text,
  influence_level text NOT NULL DEFAULT 'unknown'
    CHECK (influence_level IN ('unknown', 'recruiter', 'hiring_manager', 'manager', 'executive')),
  relationship_status text NOT NULL DEFAULT 'new'
    CHECK (relationship_status IN ('new', 'contacted', 'replied', 'warm', 'do_not_contact')),
  notes text,
  source text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by   text
);

CREATE INDEX company_people_company_idx ON company_people (company_id, last_seen_at desc);
CREATE INDEX company_people_linkedin_idx ON company_people (linkedin_url);
CREATE UNIQUE INDEX company_people_company_profile_unique_idx
  ON company_people (company_id, linkedin_url)
  WHERE linkedin_url IS NOT NULL;

-- ============================================================
-- TABLE: jobs
-- ============================================================
CREATE TABLE jobs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                    text NOT NULL,
  company                  text,
  location                 text,
  source                   text,
  role_tier                text,
  salary_range             text,
  source_url               text,
  notes                    text,
  is_active                boolean DEFAULT true,
  seniority_level          text,
  employment_type          text,
  applicants_count         integer,
  company_employees_count  integer,
  company_website          text,
  posted_at                date,
  external_job_id          text,
  tracking_id              text,
  ref_id                   text,
  apply_url                text,
  description_html         text,
  description_text         text,
  benefits                 jsonb,
  job_function             text,
  industries               text,
  input_url                text,
  company_linkedin_url     text,
  company_logo_url         text,
  company_address          jsonb,
  company_slogan           text,
  company_description      text,
  job_poster_name          text,
  job_poster_title         text,
  job_poster_profile_url   text,
  job_poster_photo_url     text,
  raw_source_payload       jsonb,
  job_category             text,
  category_tags            text[] DEFAULT '{}',
  category_relevance_score integer,
  last_seen_at             timestamptz DEFAULT now(),
  category_status          text NOT NULL DEFAULT 'pending',
  ai_suggested_category    text,
  category_error           text,
  categorized_at           timestamptz,
  category_model           text,
  salary_min               numeric,
  salary_max               numeric,
  salary_currency          text,
  salary_period            text,
  work_authorization       text,
  work_authorization_evidence text,
  raw_description          text,
  parsed_description       jsonb,
  ai_extracted_at          timestamptz,
  ai_confidence_score      numeric,
  company_id               uuid REFERENCES companies(id) ON DELETE SET NULL,
  updated_by               text,
  created_at               timestamptz DEFAULT now()
);

CREATE INDEX jobs_company_idx ON jobs (company);
CREATE INDEX jobs_tier_idx ON jobs (role_tier);
CREATE INDEX jobs_active_idx ON jobs (is_active);
CREATE INDEX jobs_external_job_id_idx ON jobs (external_job_id);
CREATE INDEX jobs_job_category_idx ON jobs (job_category);
CREATE INDEX jobs_category_tags_idx ON jobs USING gin (category_tags);
CREATE INDEX jobs_category_status_idx ON jobs (category_status);
CREATE INDEX jobs_work_authorization_idx ON jobs (work_authorization);
CREATE INDEX jobs_company_title_idx ON jobs (company, title);
CREATE INDEX jobs_ai_extracted_at_idx ON jobs (ai_extracted_at) WHERE ai_extracted_at IS NOT NULL;
CREATE INDEX jobs_created_at_desc_idx ON jobs (created_at desc);
CREATE INDEX jobs_posted_at_desc_idx ON jobs (posted_at desc);
CREATE INDEX jobs_posted_at_asc_idx ON jobs (posted_at asc);
CREATE INDEX jobs_source_idx ON jobs (source);
CREATE INDEX jobs_employment_type_idx ON jobs (employment_type);
CREATE INDEX jobs_company_id_idx ON jobs (company_id);

ALTER TABLE jobs
  ADD CONSTRAINT jobs_ai_confidence_score_check
  CHECK (ai_confidence_score IS NULL OR (ai_confidence_score >= 0 AND ai_confidence_score <= 1));

-- ============================================================
-- TABLE: resumes
-- ============================================================
CREATE TABLE resumes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id  uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  label         text NOT NULL,
  kind          text DEFAULT 'resume',
  file_url      text NOT NULL,
  filename      text NOT NULL,
  parsed_json   jsonb,
  is_original_upload boolean NOT NULL DEFAULT false,
  updated_by    text,
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX resumes_candidate_idx ON resumes (candidate_id);
CREATE INDEX resumes_candidate_created_idx ON resumes (candidate_id, created_at desc);

-- ============================================================
-- TABLE: job_categories
-- ============================================================
CREATE TABLE job_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label       text NOT NULL UNIQUE,
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- TABLE: categorization_runs
-- ============================================================
CREATE TABLE categorization_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  jobs_processed integer NOT NULL DEFAULT 0,
  jobs_failed    integer NOT NULL DEFAULT 0,
  triggered_by   text,
  error          text
);

-- ============================================================
-- TABLE: import_profiles
-- ============================================================
CREATE TABLE import_profiles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label       text NOT NULL,
  column_map  jsonb NOT NULL,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX import_profiles_created_at_desc_idx ON import_profiles (created_at desc);

-- ============================================================
-- TABLE: import_sources
-- ============================================================
CREATE TABLE import_sources (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label         text NOT NULL,
  provider      text NOT NULL CHECK (provider IN ('greenhouse', 'lever', 'ashby', 'usajobs', 'career_page')),
  token_or_url  text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  last_run_at   timestamptz,
  last_result   jsonb,
  updated_by    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX import_sources_active_idx ON import_sources (is_active);

-- ============================================================
-- TABLE: resume_styles
-- ============================================================
CREATE TABLE resume_styles (
  id                  text PRIMARY KEY,
  label               text NOT NULL,
  description         text,
  formatting_defaults jsonb NOT NULL,
  is_active           boolean NOT NULL DEFAULT true
);

-- ============================================================
-- TABLE: ai_digests
-- ============================================================
CREATE TABLE ai_digests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content       text NOT NULL,
  provider      text NOT NULL,
  generated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_digests_generated_idx ON ai_digests (generated_at desc);

-- ============================================================
-- TABLE: chat_conversations
-- ============================================================
CREATE TABLE chat_conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  title       text NOT NULL DEFAULT 'New conversation',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX chat_conversations_user_idx ON chat_conversations (user_id, updated_at desc);

-- ============================================================
-- TABLE: base_resumes
-- ============================================================
CREATE TABLE base_resumes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id    uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  name            text NOT NULL,
  target_industry text,
  target_roles    text[],
  style_id        text REFERENCES resume_styles(id) DEFAULT 'skarion_compact_professional',
  status          text NOT NULL DEFAULT 'draft',
  content         jsonb NOT NULL,
  created_by      uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  updated_by      uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  approved_by     uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX base_resumes_candidate_idx ON base_resumes (candidate_id);

-- ============================================================
-- TABLE: target_jobs
-- ============================================================
CREATE TABLE target_jobs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id        uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  job_id              uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  raw_description     text NOT NULL,
  parsed_description  jsonb,
  fit_score           numeric,
  recommendation      text,
  created_by          uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  created_at          timestamptz DEFAULT now(),
  UNIQUE (candidate_id, job_id)
);

CREATE INDEX target_jobs_candidate_idx ON target_jobs (candidate_id);
CREATE INDEX target_jobs_job_idx ON target_jobs (job_id);

-- ============================================================
-- TABLE: job_keywords
-- ============================================================
CREATE TABLE job_keywords (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_job_id   uuid NOT NULL REFERENCES target_jobs(id) ON DELETE CASCADE,
  keyword         text NOT NULL,
  category        text,
  importance      text,
  source_text     text,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX job_keywords_target_job_idx ON job_keywords (target_job_id);

-- ============================================================
-- TABLE: keyword_approvals
-- ============================================================
CREATE TABLE keyword_approvals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword_id          uuid NOT NULL REFERENCES job_keywords(id) ON DELETE CASCADE,
  candidate_id        uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  base_resume_id      uuid REFERENCES base_resumes(id) ON DELETE SET NULL,
  decision            text NOT NULL,
  evidence_status     text,
  evidence_ids        uuid[],
  notes               text,
  decided_by          uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  decided_at          timestamptz DEFAULT now()
);

CREATE INDEX keyword_approvals_candidate_idx ON keyword_approvals (candidate_id);

-- ============================================================
-- TABLE: application_resume_versions
-- ============================================================
CREATE TABLE application_resume_versions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id        uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  base_resume_id      uuid REFERENCES base_resumes(id) ON DELETE SET NULL,
  target_job_id       uuid NOT NULL REFERENCES target_jobs(id) ON DELETE CASCADE,
  content             jsonb NOT NULL,
  formatting          jsonb,
  ats_score           numeric,
  truth_score         numeric,
  one_page_fit_score  numeric,
  status              text NOT NULL DEFAULT 'draft',
  source_type         text DEFAULT 'base_resume',
  title               text,
  version_label       text,
  generated_text      text,
  source_resume_id    uuid REFERENCES base_resumes(id) ON DELETE SET NULL,
  created_by          uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX app_resume_versions_candidate_idx ON application_resume_versions (candidate_id);
CREATE INDEX app_resume_versions_target_job_idx ON application_resume_versions (target_job_id);
CREATE INDEX app_resume_versions_source_resume_idx ON application_resume_versions (source_resume_id);
CREATE INDEX app_resume_versions_source_type_idx ON application_resume_versions (source_type);

ALTER TABLE application_resume_versions
  ADD CONSTRAINT app_resume_versions_source_type_check
  CHECK (source_type IN ('base_resume', 'original_resume', 'blank', 'manual'));

-- ============================================================
-- TABLE: resume_suggestions
-- ============================================================
CREATE TABLE resume_suggestions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_resume_id   uuid NOT NULL REFERENCES application_resume_versions(id) ON DELETE CASCADE,
  section_type            text,
  target_block_id         text,
  original_text           text,
  suggested_text          text,
  reason                  text,
  jd_keyword_ids          uuid[],
  evidence_ids            uuid[],
  confidence_score        numeric,
  truth_risk              text,
  ats_impact              text,
  status                  text NOT NULL DEFAULT 'pending',
  user_instruction        text,
  created_by              text,
  created_at              timestamptz DEFAULT now(),
  resolved_at             timestamptz
);

CREATE INDEX resume_suggestions_app_resume_idx ON resume_suggestions (application_resume_id);
CREATE INDEX resume_suggestions_status_idx ON resume_suggestions (status);

-- ============================================================
-- TABLE: applications
-- ============================================================
CREATE TABLE applications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id  uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  job_id        uuid REFERENCES jobs(id) ON DELETE CASCADE,
  status        text DEFAULT 'applied',
  resume_url    text,
  resume_filename text,
  resume_id     uuid REFERENCES resumes(id) ON DELETE SET NULL,
  follow_up_at  date,
  next_action   text,
  assigned_by   text,
  assigned_to   text,
  assigned_by_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  assigned_to_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  assignment_note text,
  assignment_due_at date,
  completed_at  timestamptz,
  proof_url     text,
  proof_filename text,
  proof_uploaded_at timestamptz,
  proof_uploaded_by_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  applied_at    timestamptz DEFAULT now(),
  notes         text,
  source        text DEFAULT 'manual',
  created_by    text,
  priority      text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  review_status text NOT NULL DEFAULT 'not_required'
    CHECK (review_status IN ('not_required', 'pending', 'approved', 'changes_requested')),
  review_note   text,
  reviewed_by_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  reviewed_at   timestamptz,
  submission_url text,
  proof_required boolean NOT NULL DEFAULT false,
  adhoc_job_data jsonb,
  adhoc_job_raw_text text,
  source_type   text DEFAULT 'base_resume',
  follow_up_source text,
  follow_up_created_at timestamptz,
  follow_up_completed_at timestamptz,
  updated_by    text
);

CREATE INDEX applications_candidate_idx ON applications (candidate_id);
CREATE INDEX applications_job_idx ON applications (job_id);
CREATE INDEX applications_status_idx ON applications (status);
CREATE INDEX applications_follow_up_idx ON applications (follow_up_at);
CREATE INDEX applications_assigned_to_idx ON applications (assigned_to);
CREATE INDEX applications_assigned_by_user_idx ON applications (assigned_by_user_id);
CREATE INDEX applications_assigned_to_user_idx ON applications (assigned_to_user_id);
CREATE INDEX applications_assignment_due_idx ON applications (assignment_due_at);
CREATE INDEX applications_proof_uploaded_by_idx ON applications (proof_uploaded_by_user_id);
CREATE INDEX applications_priority_idx ON applications (priority);
CREATE INDEX applications_review_status_idx ON applications (review_status);
CREATE INDEX applications_source_type_idx ON applications (source_type);
CREATE INDEX applications_follow_up_source_idx ON applications (follow_up_source);
CREATE INDEX applications_status_due_applied_idx ON applications (status, assignment_due_at, applied_at desc);
CREATE INDEX applications_candidate_applied_idx ON applications (candidate_id, applied_at desc);

CREATE UNIQUE INDEX applications_candidate_job_unique_when_not_null
  ON applications (candidate_id, job_id)
  WHERE job_id IS NOT NULL;

ALTER TABLE applications
  ADD CONSTRAINT applications_source_type_check
  CHECK (source_type IN ('base_resume', 'original_resume', 'blank', 'manual'));

-- ============================================================
-- TABLE: application_events
-- ============================================================
CREATE TABLE application_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  from_status     text,
  to_status       text NOT NULL,
  note            text,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX application_events_application_idx ON application_events (application_id);

-- ============================================================
-- TABLE: application_comments
-- ============================================================
CREATE TABLE application_comments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id        uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  commenter_name        text NOT NULL,
  commenter_user_id     uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  body                  text NOT NULL,
  visible_to_candidate  boolean NOT NULL DEFAULT false,
  parent_comment_id     uuid REFERENCES application_comments(id) ON DELETE CASCADE,
  created_at            timestamptz DEFAULT now()
);

CREATE INDEX application_comments_application_created_idx ON application_comments (application_id, created_at desc);
CREATE INDEX application_comments_commenter_user_idx ON application_comments (commenter_user_id);
CREATE INDEX application_comments_parent_idx ON application_comments (parent_comment_id);

-- ============================================================
-- TABLE: application_packets
-- ============================================================
CREATE TABLE application_packets (
  application_id            uuid PRIMARY KEY REFERENCES applications(id) ON DELETE CASCADE,
  base_resume_id            uuid REFERENCES base_resumes(id) ON DELETE SET NULL,
  target_job_id             uuid REFERENCES target_jobs(id) ON DELETE SET NULL,
  final_resume_version_id   uuid REFERENCES application_resume_versions(id) ON DELETE SET NULL,
  approved_keyword_ids      uuid[],
  rejected_keyword_ids      uuid[],
  cover_letter              text,
  recruiter_message         text,
  hiring_manager_email      text,
  interview_prep_notes      text,
  created_by                uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  created_at                timestamptz DEFAULT now(),
  packet_status             text NOT NULL DEFAULT 'draft',
  resume_export_id          uuid REFERENCES application_resume_exports(id) ON DELETE SET NULL,
  final_notes               text,
  checklist                 jsonb NOT NULL DEFAULT '{}',
  warnings                  jsonb NOT NULL DEFAULT '[]',
  ai_summary                jsonb,
  reviewed_by               uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  approved_by               uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  sent_by                   uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  reviewed_at               timestamptz,
  approved_at               timestamptz,
  sent_at                   timestamptz,
  updated_at                timestamptz DEFAULT now()
);

CREATE INDEX idx_application_packets_status ON application_packets (packet_status);
CREATE INDEX idx_application_packets_resume_export_id ON application_packets (resume_export_id);
CREATE INDEX idx_application_packets_created_at ON application_packets (created_at);

ALTER TABLE application_packets
  ADD CONSTRAINT application_packets_status_check
  CHECK (packet_status IN ('draft', 'ready_for_review', 'approved', 'sent', 'archived'));

-- ============================================================
-- TABLE: application_proofs
-- ============================================================
CREATE TABLE application_proofs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  file_url      text NOT NULL,
  file_type     text,
  uploaded_by   uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  notes         text,
  uploaded_at   timestamptz DEFAULT now()
);

CREATE INDEX application_proofs_app_idx ON application_proofs (application_id);

-- ============================================================
-- TABLE: falood_conversations
-- ============================================================
CREATE TABLE falood_conversations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode                text NOT NULL,
  candidate_id        uuid REFERENCES candidates(id) ON DELETE CASCADE,
  base_resume_id      uuid REFERENCES base_resumes(id) ON DELETE SET NULL,
  application_resume_id uuid REFERENCES application_resume_versions(id) ON DELETE SET NULL,
  user_id             uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE INDEX falood_conv_candidate_idx ON falood_conversations (candidate_id);
CREATE INDEX falood_conv_mode_idx ON falood_conversations (mode);

-- ============================================================
-- TABLE: falood_messages
-- ============================================================
CREATE TABLE falood_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES falood_conversations(id) ON DELETE CASCADE,
  role            text CHECK (role IN ('user', 'assistant', 'action')),
  content         text,
  command         text,
  action_json     jsonb,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX falood_messages_conv_idx ON falood_messages (conversation_id, created_at);

-- ============================================================
-- TABLE: import_runs
-- ============================================================
CREATE TABLE import_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_source_id  uuid NOT NULL REFERENCES import_sources(id) ON DELETE CASCADE,
  imported          integer,
  skipped           integer,
  error             text,
  ran_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX import_runs_source_idx ON import_runs (import_source_id, ran_at desc);

-- ============================================================
-- TABLE: saved_job_searches
-- ============================================================
CREATE TABLE saved_job_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  owner_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_shared boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX saved_job_searches_owner_idx ON saved_job_searches (owner_user_id);
CREATE INDEX saved_job_searches_shared_idx ON saved_job_searches (is_shared, created_at desc);

-- ============================================================
-- TABLE: chat_messages
-- ============================================================
CREATE TABLE chat_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content         text NOT NULL,
  tool_name       text,
  attachment_url   text,
  attachment_name  text,
  attachment_type  text,
  attachment_text  text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX chat_messages_conversation_idx ON chat_messages (conversation_id, created_at);

-- ============================================================
-- TABLE: audit_logs
-- ============================================================
CREATE TABLE audit_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id  uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  actor_email    text,
  action         text NOT NULL,
  entity_type    text NOT NULL,
  entity_id      uuid,
  metadata       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_user_id, created_at desc);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id, created_at desc);

-- ============================================================
-- TABLE: job_comments
-- ============================================================
CREATE TABLE job_comments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  commenter_name  text NOT NULL,
  commenter_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  body            text NOT NULL,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX job_comments_job_created_idx ON job_comments (job_id, created_at desc);
CREATE INDEX job_comments_commenter_user_idx ON job_comments (commenter_user_id);

-- ============================================================
-- TABLE: job_crawler_status
-- ============================================================
CREATE TABLE job_crawler_status (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  crawler_name                text NOT NULL UNIQUE,
  is_active                   boolean NOT NULL DEFAULT true,
  last_heartbeat_at           timestamptz,
  offline_threshold_minutes   integer NOT NULL DEFAULT 10,
  message                     text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  updated_by                  text
);

-- ============================================================
-- TABLE: integration_oauth_states
-- ============================================================
CREATE TABLE integration_oauth_states (
  state text PRIMARY KEY,
  provider text NOT NULL CHECK (provider IN ('gmail')),
  owner_type text NOT NULL CHECK (owner_type IN ('profile', 'candidate', 'shared_application_mailbox')),
  owner_user_id uuid REFERENCES profiles(user_id) ON DELETE CASCADE,
  candidate_id uuid REFERENCES candidates(id) ON DELETE CASCADE,
  redirect_after text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX integration_oauth_states_expires_idx ON integration_oauth_states (expires_at);

-- ============================================================
-- TABLE: integration_accounts
-- ============================================================
CREATE TABLE integration_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('gmail')),
  owner_type text NOT NULL CHECK (owner_type IN ('profile', 'candidate', 'shared_application_mailbox')),
  owner_user_id uuid REFERENCES profiles(user_id) ON DELETE CASCADE,
  candidate_id uuid REFERENCES candidates(id) ON DELETE CASCADE,
  email text,
  scopes text[] NOT NULL DEFAULT '{}',
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'error')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX integration_accounts_provider_owner_idx ON integration_accounts (provider, owner_type, owner_user_id, candidate_id);
CREATE UNIQUE INDEX integration_accounts_gmail_profile_unique_idx ON integration_accounts (provider, owner_user_id) WHERE provider = 'gmail' AND owner_type = 'profile' AND owner_user_id IS NOT NULL;
CREATE UNIQUE INDEX integration_accounts_gmail_candidate_unique_idx ON integration_accounts (provider, candidate_id) WHERE provider = 'gmail' AND owner_type = 'candidate' AND candidate_id IS NOT NULL;
CREATE UNIQUE INDEX integration_accounts_gmail_shared_unique_idx ON integration_accounts (provider, owner_type) WHERE provider = 'gmail' AND owner_type = 'shared_application_mailbox';

-- ============================================================
-- TABLE: integration_events
-- ============================================================
CREATE TABLE integration_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  event_type text NOT NULL,
  external_id text,
  title text,
  message text,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'success', 'warning', 'error')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  delivery_status text NOT NULL DEFAULT 'received' CHECK (delivery_status IN ('received', 'sent', 'failed')),
  delivery_error text,
  acknowledged_at timestamptz,
  acknowledged_by text,
  acknowledgement_note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX integration_events_source_created_idx ON integration_events (source, created_at desc);
CREATE INDEX integration_events_external_idx ON integration_events (source, external_id);
CREATE INDEX integration_events_ack_idx ON integration_events (acknowledged_at, created_at desc);

-- ============================================================
-- TABLE: public_api_keys
-- ============================================================
CREATE TABLE public_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  key_prefix text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  scopes text[] NOT NULL DEFAULT '{}',
  created_by_user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  created_by_email text,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

CREATE INDEX public_api_keys_prefix_idx ON public_api_keys (key_prefix);
CREATE INDEX public_api_keys_revoked_idx ON public_api_keys (revoked_at);
CREATE INDEX public_api_keys_scopes_idx ON public_api_keys USING gin (scopes);

-- ============================================================
-- TABLE: candidate_evidence
-- ============================================================
CREATE TABLE candidate_evidence (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id      uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  source_type       text NOT NULL,
  title             text NOT NULL,
  description       text,
  related_skills    text[],
  proof_url         text,
  confidence_score  numeric DEFAULT 0.7,
  created_by        uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX evidence_candidate_idx ON candidate_evidence (candidate_id);
CREATE INDEX evidence_source_type_idx ON candidate_evidence (source_type);

-- ============================================================
-- TABLE: job_duplicates
-- ============================================================
CREATE TABLE job_duplicates (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_job_id  uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  duplicate_job_id  uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  similarity_score  numeric NOT NULL,
  resolved          boolean NOT NULL DEFAULT false,
  created_at        timestamptz DEFAULT now(),
  UNIQUE (canonical_job_id, duplicate_job_id)
);

CREATE INDEX job_duplicates_canonical_idx ON job_duplicates (canonical_job_id);
CREATE INDEX job_duplicates_duplicate_idx ON job_duplicates (duplicate_job_id);

-- ============================================================
-- TABLE: application_job_keywords
-- ============================================================
CREATE TABLE application_job_keywords (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  keyword text NOT NULL,
  normalized_keyword text NOT NULL,
  category text NOT NULL,
  importance text NOT NULL DEFAULT 'medium',
  source text NOT NULL DEFAULT 'ai_jd_analysis',
  status text NOT NULL DEFAULT 'pending',
  ai_reason text,
  user_reason text,
  evidence_summary text,
  evidence_status text NOT NULL DEFAULT 'unmapped',
  created_by uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  CONSTRAINT application_job_keywords_importance_check CHECK (
    importance IN ('low', 'medium', 'high', 'critical')
  ),
  CONSTRAINT application_job_keywords_category_check CHECK (
    category IN ('skill', 'tool', 'responsibility', 'certification', 'education', 'experience', 'domain', 'soft_skill', 'visa', 'red_flag', 'other')
  ),
  CONSTRAINT application_job_keywords_source_check CHECK (
    source IN ('ai_jd_analysis', 'manual', 'imported')
  ),
  CONSTRAINT application_job_keywords_status_check CHECK (
    status IN ('pending', 'approved', 'rejected', 'needs_evidence')
  ),
  CONSTRAINT application_job_keywords_evidence_status_check CHECK (
    evidence_status IN ('unmapped', 'mapped', 'weak', 'missing')
  ),
  CONSTRAINT application_job_keywords_unique_per_app UNIQUE (application_id, normalized_keyword)
);

CREATE INDEX idx_application_job_keywords_application_id ON application_job_keywords (application_id);
CREATE INDEX idx_application_job_keywords_job_id ON application_job_keywords (job_id);
CREATE INDEX idx_application_job_keywords_status ON application_job_keywords (status);
CREATE INDEX idx_application_job_keywords_normalized_keyword ON application_job_keywords (normalized_keyword);
CREATE INDEX idx_application_job_keywords_evidence_status ON application_job_keywords (evidence_status);
CREATE INDEX idx_application_job_keywords_category_importance ON application_job_keywords (category, importance);

-- ============================================================
-- TABLE: ai_api_keys
-- ============================================================
CREATE TABLE ai_api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  label text NOT NULL,
  encrypted_key text NOT NULL,
  key_fingerprint text NOT NULL,
  priority integer NOT NULL DEFAULT 100,
  is_enabled boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'unknown',
  last_tested_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  usage_count integer NOT NULL DEFAULT 0,
  failure_count integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  CONSTRAINT ai_api_keys_status_check CHECK (
    status IN ('unknown', 'working', 'failing', 'disabled')
  )
);

CREATE INDEX idx_ai_api_keys_enabled_priority ON ai_api_keys (is_enabled, priority, created_at);
CREATE INDEX idx_ai_api_keys_provider ON ai_api_keys (provider);

-- ============================================================
-- TABLE: application_resume_suggestions
-- ============================================================
CREATE TABLE application_resume_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  resume_version_id uuid REFERENCES application_resume_versions(id) ON DELETE SET NULL,
  keyword_id uuid REFERENCES application_job_keywords(id) ON DELETE SET NULL,
  suggestion_type text NOT NULL,
  target_section text NOT NULL,
  target_subsection_id text,
  original_text text,
  proposed_text text NOT NULL,
  ai_reasoning text,
  truth_status text NOT NULL DEFAULT 'unverified',
  truth_check_details text,
  source_evidence text,
  status text NOT NULL DEFAULT 'pending',
  user_notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  CONSTRAINT application_resume_suggestions_type_check CHECK (
    suggestion_type IN ('content_change', 'format_improvement', 'truth_warning', 'keyword_injection', 'missing_evidence')
  ),
  CONSTRAINT application_resume_suggestions_section_check CHECK (
    target_section IN ('summary', 'skills', 'experience', 'education', 'certifications', 'projects', 'header')
  ),
  CONSTRAINT application_resume_suggestions_truth_check CHECK (
    truth_status IN ('verified', 'unverified', 'fabrication_risk')
  ),
  CONSTRAINT application_resume_suggestions_status_check CHECK (
    status IN ('pending', 'accepted', 'rejected', 'applied')
  )
);

CREATE INDEX idx_application_resume_suggestions_application_id ON application_resume_suggestions (application_id);
CREATE INDEX idx_application_resume_suggestions_resume_version_id ON application_resume_suggestions (resume_version_id);
CREATE INDEX idx_application_resume_suggestions_keyword_id ON application_resume_suggestions (keyword_id);
CREATE INDEX idx_application_resume_suggestions_status ON application_resume_suggestions (status);
CREATE INDEX idx_application_resume_suggestions_type ON application_resume_suggestions (suggestion_type);
CREATE INDEX idx_application_resume_suggestions_truth_status ON application_resume_suggestions (truth_status);
CREATE INDEX idx_application_resume_suggestions_section_status ON application_resume_suggestions (target_section, status);

-- ============================================================
-- TABLE: application_resume_exports
-- ============================================================
CREATE TABLE application_resume_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  resume_version_id uuid NOT NULL REFERENCES application_resume_versions(id) ON DELETE CASCADE,
  export_type text NOT NULL,
  file_name text NOT NULL,
  file_path text,
  storage_provider text,
  file_size_bytes integer,
  status text NOT NULL DEFAULT 'created',
  error text,
  created_by uuid REFERENCES profiles(user_id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),

  CONSTRAINT application_resume_exports_type_check CHECK (
    export_type IN ('docx', 'pdf', 'markdown', 'text')
  ),
  CONSTRAINT application_resume_exports_status_check CHECK (
    status IN ('created', 'failed', 'deleted')
  )
);

CREATE INDEX idx_application_resume_exports_application_id ON application_resume_exports (application_id);
CREATE INDEX idx_application_resume_exports_resume_version_id ON application_resume_exports (resume_version_id);
CREATE INDEX idx_application_resume_exports_export_type ON application_resume_exports (export_type);
CREATE INDEX idx_application_resume_exports_created_at ON application_resume_exports (created_at);

-- ============================================================
-- TABLE: interview_schedules
-- ============================================================
CREATE TABLE interview_schedules (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id        uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  round_number          integer NOT NULL DEFAULT 1,
  round_name            text NOT NULL,
  scheduled_at          timestamptz,
  duration_minutes      integer DEFAULT 60,
  status                text DEFAULT 'scheduled',
  location              text,
  meeting_link          text,
  created_by            text NOT NULL,
  created_at            timestamptz DEFAULT now()
);

CREATE INDEX interview_schedules_app_idx ON interview_schedules (application_id);
CREATE INDEX interview_schedules_status_idx ON interview_schedules (status);
CREATE INDEX interview_schedules_date_idx ON interview_schedules (scheduled_at);

-- ============================================================
-- TABLE: interview_panel_members
-- ============================================================
CREATE TABLE interview_panel_members (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id           uuid NOT NULL REFERENCES interview_schedules(id) ON DELETE CASCADE,
  interviewer_id        text NOT NULL,
  role                  text DEFAULT 'interviewer',
  status                text DEFAULT 'pending',
  feedback_submitted    boolean DEFAULT false,
  created_at            timestamptz DEFAULT now()
);

CREATE INDEX interview_panel_schedule_idx ON interview_panel_members (schedule_id);
CREATE INDEX interview_panel_interviewer_idx ON interview_panel_members (interviewer_id);

-- ============================================================
-- TABLE: interview_scorecards
-- ============================================================
CREATE TABLE interview_scorecards (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id           uuid NOT NULL REFERENCES interview_schedules(id) ON DELETE CASCADE,
  panel_member_id       uuid NOT NULL REFERENCES interview_panel_members(id),
  overall_rating        integer CHECK (overall_rating BETWEEN 1 AND 5),
  recommendation        text,
  competencies          jsonb DEFAULT '[]',
  overall_notes         text,
  verdict_notes         text,
  submitted_at          timestamptz,
  created_at            timestamptz DEFAULT now()
);

CREATE INDEX scorecard_schedule_idx ON interview_scorecards (schedule_id);
CREATE INDEX scorecard_panel_idx ON interview_scorecards (panel_member_id);

-- ============================================================
-- TABLE: interview_scorecard_templates
-- ============================================================
CREATE TABLE interview_scorecard_templates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                text,
  name                  text NOT NULL,
  role_type             text,
  competencies          text[] DEFAULT '{}',
  is_default            boolean DEFAULT false,
  created_at            timestamptz DEFAULT now()
);

CREATE INDEX scorecard_template_org_idx ON interview_scorecard_templates (org_id);

-- ============================================================
-- TABLE: email_templates
-- ============================================================
CREATE TABLE email_templates (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                text,
  name                  text NOT NULL,
  subject               text NOT NULL,
  body                  text NOT NULL,
  category              text DEFAULT 'general',
  is_default            boolean DEFAULT false,
  created_by            text NOT NULL,
  created_at            timestamptz DEFAULT now()
);

CREATE INDEX email_template_org_idx ON email_templates (org_id);
CREATE INDEX email_template_category_idx ON email_templates (category);

-- ============================================================
-- TABLE: email_sequences
-- ============================================================
CREATE TABLE email_sequences (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                text,
  name                  text NOT NULL,
  description           text,
  trigger_event         text,
  is_active             boolean DEFAULT true,
  created_by            text NOT NULL,
  created_at            timestamptz DEFAULT now()
);

CREATE INDEX email_sequence_org_idx ON email_sequences (org_id);

-- ============================================================
-- TABLE: email_sequence_steps
-- ============================================================
CREATE TABLE email_sequence_steps (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id           uuid NOT NULL REFERENCES email_sequences(id) ON DELETE CASCADE,
  step_number           integer NOT NULL,
  template_id           uuid NOT NULL REFERENCES email_templates(id),
  delay_hours           integer NOT NULL DEFAULT 24,
  send_time             text,
  condition             text,
  created_at            timestamptz DEFAULT now()
);

CREATE INDEX sequence_step_sequence_idx ON email_sequence_steps (sequence_id);

-- ============================================================
-- TABLE: email_logs
-- ============================================================
CREATE TABLE email_logs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id          uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  template_id           uuid REFERENCES email_templates(id),
  sequence_id           uuid REFERENCES email_sequences(id),
  step_number           integer,
  subject               text NOT NULL,
  body                  text NOT NULL,
  status                text DEFAULT 'sent',
  opened_at             timestamptz,
  clicked_at            timestamptz,
  replied_at            timestamptz,
  error_message         text,
  sent_by               text,
  sent_at               timestamptz DEFAULT now()
);

CREATE INDEX email_log_candidate_idx ON email_logs (candidate_id);
CREATE INDEX email_log_status_idx ON email_logs (status);
CREATE INDEX email_log_sent_idx ON email_logs (sent_at);

-- ============================================================
-- TABLE: email_queue
-- ============================================================
CREATE TABLE email_queue (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id          uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  sequence_id           uuid NOT NULL REFERENCES email_sequences(id) ON DELETE CASCADE,
  step_number           integer NOT NULL,
  template_id           uuid NOT NULL REFERENCES email_templates(id),
  delay_hours           integer NOT NULL DEFAULT 24,
  trigger_at            timestamptz NOT NULL,
  status                text DEFAULT 'pending',
  sent_at               timestamptz,
  error                 text,
  created_at            timestamptz DEFAULT now()
);

CREATE INDEX email_queue_status_trigger_idx ON email_queue (status, trigger_at);
CREATE INDEX email_queue_candidate_idx ON email_queue (candidate_id);

-- ============================================================
-- TABLE: candidate_messages
-- ============================================================
CREATE TABLE candidate_messages (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id          uuid NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  direction             text NOT NULL,
  channel               text NOT NULL,
  subject               text,
  body                  text NOT NULL,
  sender_id             text,
  sender_name           text,
  read_at               timestamptz,
  created_at            timestamptz DEFAULT now()
);

CREATE INDEX candidate_msg_candidate_idx ON candidate_messages (candidate_id);
CREATE INDEX candidate_msg_created_idx ON candidate_messages (created_at);

-- ============================================================
-- TABLE: webhook_endpoints
-- ============================================================
CREATE TABLE webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id text,
  name text NOT NULL,
  url text NOT NULL,
  secret text,
  events text[] DEFAULT '{}',
  status text DEFAULT 'active',
  last_delivered_at timestamptz,
  last_failure_at timestamptz,
  failure_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX webhook_endpoints_status_idx ON webhook_endpoints (status);

-- ============================================================
-- TABLE: webhook_events
-- ============================================================
CREATE TABLE webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id uuid REFERENCES webhook_endpoints(id),
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  response_status integer,
  response_body text,
  attempt_count integer DEFAULT 1,
  max_attempts integer DEFAULT 5,
  delivered_at timestamptz,
  failed_at timestamptz,
  error_message text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX webhook_events_endpoint_idx ON webhook_events (endpoint_id);

-- ============================================================
-- TABLE: notifications
-- ============================================================
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  type text DEFAULT 'info',
  title text NOT NULL,
  body text,
  link text,
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX notifications_user_idx ON notifications (user_id);
CREATE INDEX notifications_read_idx ON notifications (read_at);

-- ============================================================
-- TABLE: activity_logs
-- ============================================================
CREATE TABLE activity_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text,
  actor_name text,
  actor_type text DEFAULT 'user',
  type text NOT NULL,
  description text NOT NULL,
  entity_type text,
  entity_id uuid,
  entity_name text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX activity_logs_type_idx ON activity_logs (type);
CREATE INDEX activity_logs_entity_idx ON activity_logs (entity_type, entity_id);

-- ============================================================
-- UPDATED_AT TRIGGERS
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER company_people_updated_at BEFORE UPDATE ON company_people FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER job_crawler_status_updated_at BEFORE UPDATE ON job_crawler_status FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER public_api_keys_updated_at BEFORE UPDATE ON public_api_keys FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER application_job_keywords_updated_at BEFORE UPDATE ON application_job_keywords FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER ai_api_keys_updated_at BEFORE UPDATE ON ai_api_keys FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER application_resume_suggestions_updated_at BEFORE UPDATE ON application_resume_suggestions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER application_packets_updated_at BEFORE UPDATE ON application_packets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- OTHER FUNCTIONS
-- ============================================================
CREATE OR REPLACE FUNCTION get_funnel_counts(
  date_from timestamptz DEFAULT NULL,
  date_to timestamptz DEFAULT NULL
) RETURNS TABLE (
  stage text,
  count bigint
) AS $$
BEGIN
  RETURN QUERY
  SELECT 'sourced'::text, COUNT(*)::bigint FROM candidates
    WHERE (date_from IS NULL OR created_at >= date_from)
      AND (date_to IS NULL OR created_at <= date_to)
  UNION ALL
  SELECT 'applied', COUNT(*) FROM applications
    WHERE (date_from IS NULL OR applied_at >= date_from)
      AND (date_to IS NULL OR applied_at <= date_to)
  UNION ALL
  SELECT 'screened', COUNT(*) FROM applications
    WHERE status = 'screening'
      AND (date_from IS NULL OR applied_at >= date_from)
      AND (date_to IS NULL OR applied_at <= date_to)
  UNION ALL
  SELECT 'interviewed', COUNT(*) FROM interview_schedules
    WHERE status = 'completed'
      AND (date_from IS NULL OR scheduled_at >= date_from)
      AND (date_to IS NULL OR scheduled_at <= date_to)
  UNION ALL
  SELECT 'offered', COUNT(*) FROM applications
    WHERE status = 'offer'
      AND (date_from IS NULL OR applied_at >= date_from)
      AND (date_to IS NULL OR applied_at <= date_to)
  UNION ALL
  SELECT 'hired', COUNT(*) FROM candidates
    WHERE status = 'placed'
      AND (date_from IS NULL OR created_at >= date_from)
      AND (date_to IS NULL OR created_at <= date_to);
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- AUTH-RELATED FUNCTION (commented out for Neon)
-- ============================================================
-- handle_new_auth_user: creates a trigger on auth.users which does not exist in Neon.
-- Kept as a reference for hybrid auth compatibility.
--
-- CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
-- RETURNS trigger
-- LANGUAGE plpgsql
-- SET search_path = public
-- AS $$
-- BEGIN
--   INSERT INTO public.profiles (user_id, email, display_name, role)
--   VALUES (
--     new.id,
--     new.email,
--     coalesce(new.raw_user_meta_data->>'display_name', split_part(coalesce(new.email, ''), '@', 1), ''),
--     coalesce(nullif(new.raw_user_meta_data->>'role', ''), 'recruiter')
--   )
--   ON CONFLICT (user_id) DO UPDATE
--     SET email = excluded.email,
--         updated_at = now();
--   RETURN new;
-- END;
-- $$;
--
-- CREATE TRIGGER on_auth_user_created
-- AFTER INSERT ON auth.users
-- FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
