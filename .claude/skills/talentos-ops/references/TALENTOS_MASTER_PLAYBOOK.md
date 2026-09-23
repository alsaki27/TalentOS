# TalentOS Operations Agent — Consolidated Master Playbook

Version: 4.0 (merged + schema-verified against live repo + reconciled with the Codex-built plugin)
Repository verified: `https://github.com/alsaki27/TalentOS`, commit `d2d2f208ef0574a9e0acedc66e27f88207d4dc12` ("feat: complete email inbox redesign with global candidate filter, precise pagination, perfect plain text rendering, and portal modals"), cloned and inspected 2026-08-19 at `C:\Users\sakis\OneDrive\Documents\Claude\TalentOS_repo`.
Also reconciled against a second, local production checkout at `C:\Users\sakis\OneDrive\Documents\ChatGPT\TalentOS\TalentOS-production`, where a Codex-built agent had already produced its own plugin (`plugins/talentos-ops-agent/`) and a companion doc, `docs/TALENTOS_OPERATIONS_PLAYBOOK.md`. That doc turned out to have live-database-verified table names this pass hadn't found from migration files alone (`application_ai_workflows`, `job_agent_configs`, `candidate_source_of_truth`, `email_communications`) — all confirmed for real in `sql/07_application_ai_workflows.sql`, `sql/neon_fixes/040_source_of_truth.sql`, `migrations/job_agent_tables.sql`, and `sql/neon_fixes/046_email_triage_and_gmail_sync.sql` respectively, and folded in below. Codex's discipline sections (mode classification, information_schema-first inspection, source precedence, regression suite, runtime-secret contract) are merged into Sections 3, 15, and 22.
Source documents merged: (1) TalentOS Job Intelligence Orchestrator system prompt, (2) TalentOS Prompt Library and Plugin Specification, (3) TalentOS Prompt Catalog and Plugin Playbook (14 sections + architecture recommendation) — this one already lives in the repo verbatim as `docs/TALENTOS_PLUGIN_PROMPT_LIBRARY.md`, confirming it's the org's real working doc, not a one-off — (4) live schema (`neon/migrations/`, `sql/neon_fixes/`, `sql/*.sql`, `migrations/*.sql`) and the repo's own internal docs (`AE_APPLICATION_ENGINEER_PLAYBOOK.md`, `EXECUTIVE_AE_BANDWIDTH_REPORT_2026-08-11.md`), (5) Codex's `docs/TALENTOS_OPERATIONS_PLAYBOOK.md`.

**This version corrects the earlier drafts against the real database twice over** — once from reading migration SQL directly, once more from reconciling against Codex's independently-produced (and apparently live-DB-verified) playbook. Anywhere the original three prompt documents used illustrative names (`role_fit_score` on a 0–10 scale, uppercase stage names like `AI_PIPELINE`, a generic `stage_history` table, an imagined `recruiter_contacts` table), this version replaces them with actual table/column names and value vocabularies, and flags the couple of places that still need a live `information_schema` check before being trusted blindly.

**Architecture fact worth flagging up front:** the repo contains *two* backend tracks. The Next.js app's own `src/server/` + `src/lib/` talk to Neon directly (raw SQL / query builders) and own the rich recruiting-specific tables below. A separate NestJS + TypeORM service lives under `backend/` (`backend/src/entities/*.entity.ts`, `backend/src/modules/{billing,organizations,invites,public-api-keys,...}`) with a *smaller* entity set that mirrors a subset of the same table names (candidates, applications, jobs, companies, profiles, resumes, import_*, integration_*, chat_*). Confirm which service actually owns writes for a given table in the target environment before assuming "the database" means one connection — don't guess from source code alone, per Codex's own P01/P02 discipline below.

---

## 0. About this document

Single source of truth for the `talentos-ops-agent` — a plugin/skill that inspects, matches, scores, tailors, exports, and tracks recruiting applications for TalentOS, and can operate directly against its backend (Neon/Postgres, SharePoint, Gmail, GitHub, Cloudflare, the browser extension) once wired to real credentials via a secret store.

No credentials, connection strings, tokens, or mailbox content are held in this document, and no live database write has been performed to produce it — schema facts below come from reading migration SQL in the repo, not from querying a running database. Before any command in Section 14/21 mutates production data, re-confirm the relevant table against `\d <table>` or an equivalent live schema check, since migrations can land after this snapshot.

Two layers, kept together on purpose:
- **Original request inventory** (Section 19) — the literal asks, kept as regression-test examples.
- **Improved command prompts** (Sections 14 & 21) — structured, schema-first, dry-run-first versions of those same asks, in a consistent template, now bound to real column names.

---

## 1. Mission

Increase qualified-interview conversion for active candidates while preserving factual accuracy, resume integrity, candidate privacy, workflow continuity, and full operational traceability. Volume is a byproduct of quality matching, never a target pursued on its own. This directly serves the AE department: **Akash (AE department manager)** needs to see high-ROI roles as they appear, assign them to the right AE, and pull trustworthy reports on who applied how much and whose tailoring holds up — Section 21 is built specifically for that.

Goals, unabridged:
1. Find recently posted jobs before they go stale.
2. Match each job against every relevant active candidate and base resume.
3. Prefer remote roles and candidate-approved locations.
4. Produce 20–50 strong opportunities per active candidate when enough quality jobs exist (the live matcher's own `max_recommendations_per_candidate` cap is 50 — see Section 5).
5. Never reuse one generic resume across unrelated roles.
6. Generate or select the correct niche-specific resume per role.
7. Send qualified records through the AI pipeline.
8. Stop at `ready_for_review` unless the user explicitly authorizes applications.
9. Preserve application IDs, job IDs, base resume IDs, tailored resume version IDs, export IDs, and SharePoint links across every operation.
10. Make every action idempotent, auditable, and reversible.

---

## 2. Canonical data model (verified against `neon/migrations/0001_initial_schema.sql` + `sql/neon_fixes/*`)

All tables are Postgres/Neon, `uuid` primary keys via `gen_random_uuid()`. Only fields relevant to matching, assignment, tailoring, and reporting are listed — read the migration files for the full column set before writing.

### `candidates`
`id`, `name`, `email`, `phone`, `status` (default `'active'`), `pipeline_stage` (`not_started|applying|paused|placed|dropped`), `target_tier`, `resume_url`/`resume_filename`, `target_roles`, `preferred_locations`, `salary_expectation`, `work_authorization`, `location_preference`, `work_mode_preference`, `visa_status`, `target_industries text[]`, `available_start_date`, `portal_token`, `notes`.
*"Active candidate" = `status = 'active'`, not a separate boolean.*

### `base_resumes`
`id`, `candidate_id` → candidates, `name`, `target_industry`, `target_roles text[]`, `style_id` → resume_styles, `status` (default `'draft'`), `content jsonb`, `created_by`/`updated_by`/`approved_by` → profiles.

### `jobs`
`id`, `title`, `company`, `location`, `source`, `source_url`, `posted_at date`, `is_active`, `seniority_level`, `employment_type`, `salary_min`/`salary_max`/`salary_currency`, `work_authorization`, `description_text`/`description_html`, `raw_description`, `parsed_description jsonb`, `job_category`, `category_tags text[]`, `external_job_id`, `company_id` → companies, `created_at`.
*Freshness = `posted_at`, not `created_at`. Dedup fields present: `external_job_id`, plus `job_duplicates(canonical_job_id, duplicate_job_id, similarity_score, resolved)`.*

### `applications` — the canonical workflow record
`id`, `candidate_id`, `job_id`, `base_resume_id` (added in `067_candidate_job_matcher.sql`, FK → base_resumes), `resume_id` → resumes, `status` (**legacy**, default `'applied'`), `application_stage` (**canonical**, added in `20260813_application_stage_canonicalization.sql` / `070_application_stage_history.sql`), `application_stage_changed_at`, `application_stage_changed_by_user_id`, `application_stage_changed_by_name`, `ae_stage` (**legacy**, still populated in parallel — see Section 10 caveat), `priority` (`low|normal|high|urgent`), `review_status` (`not_required|pending|approved|changes_requested`), `reviewed_by_user_id`, `reviewed_at`, `assigned_to`/`assigned_to_user_id`, `assigned_by`/`assigned_by_user_id`, `assignment_note`, `assignment_due_at`, `ae_applied_by_user_id`/`ae_applied_by_name`/`ae_applied_at` (added `047_ae_applied_attribution.sql`), `applied_at`, `follow_up_at`, `next_action`, `source` (default `'manual'`), `source_type` (`base_resume|original_resume|blank|manual`), `submission_url`, `proof_url`/`proof_uploaded_by_user_id`, `automation_idempotency_key` (unique, partial index — the real idempotency mechanism).
Unique constraint: `(candidate_id, job_id)` where `job_id IS NOT NULL` — this **is** the duplicate-prevention guarantee, not just a convention.

### `application_stage_history` — the real audit trail (`sql/neon_fixes/070_application_stage_history.sql`)
`id`, `application_id`, `from_stage`, `to_stage`, `changed_at`, `changed_by_user_id`, `changed_by_name`, `reason`, `source`.
*`source` values observed in production reporting: `'queue'` (real human/queue action), `'ai_pipeline'`, `'email_ai'`, `'migration'` (backfilled, must be excluded from throughput counts — see Section 10 and 21.3).*

### `application_resume_versions` — the tailored resume
`id`, `candidate_id`, `base_resume_id`, `target_job_id` → target_jobs, `content jsonb`, `ats_score` (double, from the Hiring Panel agent's `ReviewScoreV1.atsScore`, added `023`), `truth_score` (double, added `023`), `one_page_fit_score` (double, `contentUtilization*100`, added `086`), `page_fit_metrics jsonb` (full `PageFitV1`: pageCount, contentUtilization, bottomWhitespaceInches, overflow, readable, recommendation — added `086`), `status`, `source_type`, `created_by` → profiles, `created_at`.

### `application_packets` — the reviewable bundle that ties an application to its final resume
`application_id` (PK) → applications, `base_resume_id`, `target_job_id`, `final_resume_version_id` → application_resume_versions, `packet_status` (`draft|ready_for_review|approved|sent|archived`), `resume_export_id` → application_resume_exports, `checklist jsonb`, `warnings jsonb`, `ai_summary jsonb`, `reviewed_by`/`approved_by`/`sent_by` → profiles, `reviewed_at`/`approved_at`/`sent_at`.
*This is the correct join for "who is accountable for this packet" — see Section 21.4.*

### `application_resume_exports` — the SharePoint/PDF export record
`id`, `application_id`, `resume_version_id`, `export_type` (`docx|pdf|markdown|text`), `file_name`, `file_path`, `storage_provider`, `content_sha256` (added `071` — the idempotency key for exports), `storage_url`, `storage_item_id`, `candidate_name_snapshot`, `company_name_snapshot`, `job_title_snapshot` (added `071` — exactly the "candidate + company + job title" naming the org asked for), `status` (`created|failed|deleted`), `created_by`, `created_at`.
Unique index: `(application_id, resume_version_id, export_type, content_sha256)` where not deleted — real idempotent-export guarantee.

### `candidate_evidence` vs. `candidate_source_of_truth` — two distinct evidence tables, don't conflate them
`candidate_evidence` (initial schema): free-form supporting evidence — `source_type`, `title`, `description`, `related_skills text[]`, `proof_url`, `confidence_score`.
`candidate_source_of_truth` (`sql/neon_fixes/040_source_of_truth.sql`): one row per candidate (`UNIQUE candidate_id`), skills-specific — `confirmed_skills jsonb`, `pending_skills jsonb` (AI-suggested skills each carrying `{skill, category, reason, confidence, status: pending|accepted|rejected}`), `parsed_from_resume_id` → base_resumes, `last_parsed_at`. This is the accept/decline queue for AI-extracted skills, not the general evidence bank.

### `job_agent_configs` / `job_agent_runs` / `job_agent_staged_jobs` — the real job-ingestion pipeline (`migrations/job_agent_tables.sql`, `sql/neon_fixes/043_job_sources.sql`, `049_job_agent_nightly_batches.sql`)
This — not the older `import_sources`/`import_runs` pair from the initial schema — is the actively used ingestion path: an Apify-driven scraper (`actor_id` default `khadinakbar~google-jobs-scraper`).
`job_agent_configs`: `label`, `apify_token_encrypted`, `actor_id`, `date_posted`, `employment_type`, `proxy_country`, `max_results`, `budget_per_day_usd`, `role_groups text[]`, `is_active`.
`job_agent_runs`: `config_id`, `apify_run_id`/`apify_dataset_id`, `status`, `raw_count`/`deduped_count`/`imported_count`/`skipped_count`/`classified_count`, `estimated_cost_usd`, `role_groups_ran`, `started_at`/`completed_at`.
`job_agent_staged_jobs`: the pre-import staging row — `job_title`, `company_name`, `location`, `salary_range`, `date_posted`, `via_platform`, `source_url`, `apply_link`, `is_remote`, `role_group`/`role_group_label`, `seniority_guess`, `tier`/`tier_reason`, `ai_keywords text[]`, `relevance_score numeric(4,2)`, `is_false_positive`, `dedup_hash`, `is_duplicate`, `import_status`, `imported_job_id` (→ the real `jobs.id` once promoted).
*Freshness/dedup logic in Section 4 should run against this staging table, not assume every scraped job lands directly in `jobs`.*

### `application_ai_workflows` / `application_ai_stage_runs` / `application_ai_artifacts` / `ai_agent_configs` — the real AI pipeline (`sql/07_application_ai_workflows.sql`)
This is the actual multi-agent pipeline engine — richer than `application_packets` alone, which is the *output bundle*, not the execution engine.
`application_ai_workflows`: one row per pipeline attempt — `application_id`, `base_resume_id` (→ `application_resume_versions`, despite the name), `status` (`queued|running|waiting|failed|cancelled|completed`), `current_stage int`, `idempotency_key` (unique, partial index — the real dedupe guarantee for "exactly one workflow per application attempt"), `config_snapshot jsonb`, `started_by` → profiles, `last_error`.
`application_ai_stage_runs`: one row per agent attempt within a workflow — `workflow_id`, `automation_id`, `sequence_number`, `attempt_number`, `status` (`pending|running|success|failed|skipped|cancelled`), `provider`/`model`/`ai_key_id`, `prompt_version`, `input_artifact_id`/`output_artifact_id`, `input_tokens`/`output_tokens`, `estimated_cost_usd`, `latency_ms`, `error_code`/`error_message`. Unique on `(workflow_id, sequence_number, attempt_number)`.
`application_ai_artifacts`: immutable output per stage — `workflow_id`, `automation_id`, `sequence_number`, `schema_version`, `content_hash`, `data jsonb`.
`ai_agent_configs`: the real four-agent registry, keyed by `automation_id`, each with `system_prompt`/`prompt_version`/`output_schema_version`, `temperature`, `max_output_tokens`, `timeout_ms`, `max_attempts`, `approval_policy` (`auto|risk_based|always_human`), `minimum_score numeric(3,1)`. The seeded agents, in pipeline order:

| `automation_id` | Display name | Output schema | Approval policy | Minimum score |
|---|---|---|---|---|
| `application_job_lens` | Job Lens | `JobAnalysisV1` | auto | 0 |
| `application_resume_forge` | Resume Forge | `ResumeDraftV1` | risk_based | 0 |
| `application_hiring_panel` | Hiring Panel | `ReviewScoreV1` | auto | **6.0** |
| `application_final_polish` | Final Polish | `FinalResumeV1` | auto | 0 |

**Two separate scoring scales exist in this system — do not conflate them:** `ai_agent_configs.minimum_score` / the Hiring Panel's `ReviewScoreV1.atsScore` (which lands in `application_resume_versions.ats_score`) is a **0–10 decimal scale**. `candidate_job_match_decisions.score` (the job-to-candidate matcher, Section 5) is a separate **0–100 integer scale** with A/B tiers. A "6.0" from one and an "85" from the other are not comparable numbers — always report which scale a score came from.

### `email_communications` — the real Gmail message store (`sql/neon_fixes/046_email_triage_and_gmail_sync.sql`)
`id`, `candidate_id`, `integration_account_id` → integration_accounts, `gmail_message_id` (unique index), `gmail_thread_id`, `direction` (`inbound|outbound`), `from_email`, `to_emails text[]`, `subject`, `snippet`, `body_text`, `sent_at`, `ingested_at`, `ai_relevant`, `ai_category`, `ai_confidence`, `ai_summary`, `ai_matched_application_id` → applications, `needs_reply`, `replied_at`, `triaged_at`. This is the real triage/classification target for Section 12, not a generic "gmail_messages" table.

### `candidate_job_match_runs` / `candidate_job_match_decisions` — the real matching engine (`sql/neon_fixes/067_candidate_job_matcher.sql`)
`candidate_job_match_runs`: `id`, `run_key` (unique), `trigger_type` (`scheduled|manual|recovery`), `mode` (`dry_run|ae_review`), `status`, `freshness_days` (1–30, default 7), `tier_a_min` (default **85**), `tier_b_min` (default **70**), `max_recommendations_per_candidate` (1–50, default 50), `assigned_to_user_id`, `candidate_count`/`job_count`/`evaluated_count`/`recommended_count`/`rejected_count`.
`candidate_job_match_decisions`: `id`, `run_id`, `candidate_id`, `base_resume_id`, `profile_id` → candidate_resume_search_profiles, `job_id`, **`score integer 0–100`** (not 0–10 — the earlier draft's decimal scale was illustrative, not real), `tier` (`A|B`), `outcome` (`recommended|rejected`), `reason`, `matched_terms jsonb`, `dismissed_term_hits jsonb`, `score_breakdown jsonb`, `hard_gates jsonb`, `job_posted_at`, `freshness_cutoff`, `review_status` (`not_applicable|pending|approved|rejected`), `reviewed_by_user_id`/`reviewed_at`/`review_note`, `application_id` (set once promoted to a real application).

### `profiles` — users and roles
`user_id` (PK, Supabase Auth ID), `email`, `display_name`, `role` (`admin|manager|application_engineer|recruiter|reviewer`), `is_active`.
*An "AE" = `profiles.role = 'application_engineer'`. Akash, as the person who "controls the AE department," is a `role = 'manager'` (or `'admin'`) profile — resolve his `user_id` by email before using it as an actor/assignee in any write.*

### `company_people` — internal recruiter/hiring-manager directory
`id`, `company_id` → companies, `full_name`, `title`, `linkedin_url`, `email`, `phone`, `influence_level` (`unknown|recruiter|hiring_manager|manager|executive`), `relationship_status` (`new|contacted|replied|warm|do_not_contact`), `source`, `first_seen_at`/`last_seen_at`.

### `crm_contact_sync_queue` — outbox to the external CRM (`sql/neon_fixes/085_skarion_crm_email_contacts.sql`)
`id`, `candidate_id`, `application_id`, `email_communication_id` → email_communications, `contact_email`, `contact_type` (`recruiter|hiring_manager`), `company`, `status` (`pending|syncing|synced|failed|skipped`), `crm_record_id`/`crm_entity_type`/`crm_record_url`, `attempts`, `next_attempt_at`. Unique on `(candidate_id, contact_email)`.
*So `company_people` is the internal directory; `crm_contact_sync_queue` is the durable outbox that pushes recruiter/hiring-manager contacts discovered in Gmail out to the external CRM. Both exist — don't conflate them.*

### Email / interviews / other supporting tables (verified present, abbreviated)
`interview_schedules` (`application_id`, `round_number`, `round_name`, `scheduled_at`, `status`, `location`/`meeting_link`), `interview_panel_members`, `interview_scorecards`, `email_logs`, `email_queue`, `email_sequences`/`email_sequence_steps`, `candidate_messages`, `integration_accounts` (Gmail OAuth: `provider`, `owner_type`, `scopes`, `access_token`/`refresh_token`, `status`, `last_synced_at`), `integration_events`, `audit_logs` (`actor_user_id`, `action`, `entity_type`, `entity_id`, `metadata jsonb`), `ai_api_keys` / `ai_task_category_config` (the real "AI Control Center" — see `007_ai_control_center_schema.sql`), `application_events` (older, simpler `from_status`/`to_status` log kept alongside `application_stage_history`).

Legacy fields `applications.status` and `applications.ae_stage` are read-compatible migration evidence only — **never write to them going forward; write `application_stage` and let `application_stage_history` capture the transition.**

---

## 3. Global operating contract

Every command resolves through this same seven-step order:

1. Identify exact scope: candidate, application IDs, jobs, date range, environment, actor.
2. Read the schema and current state before writing anything.
3. Explain the intended change, its destructive impact, and the rollback path.
4. Make the smallest scoped change that satisfies the request.
5. Re-read the affected records; run focused regression checks.
6. Report exact counts, IDs, errors, and anything left unresolved.
7. Commit/push code changes only when requested or required by project policy; never claim a push without verifying the commit, remote, and deployment.

### Action-type taxonomy
- **Inspect** — read-only database, repository, email, log, deployment analysis.
- **Recommend** — a ranked list or plan; no mutation.
- **Prepare** — a reviewable CSV, SQL migration, patch, or draft.
- **Execute** — an approved mutation with an audit record.
- **Verify** — proof of expected post-state.

Deleting applications, dropping columns, revoking integrations, changing candidate status, or permanently deleting files always requires explicit confirmation, unless the user already approved that exact scope in the current task.

**Word-to-mode mapping (from the Codex playbook, worth stating explicitly since it's easy to over-read a request):** "find," "audit," "check," "why," and "what happened" do **not** authorize writes — they default to `inspect`/`recommend`. "Log," "fix," "change," "delete," "send," "deploy," or "push" require the smallest interpretation consistent with the request and still need an approval gate for destructive or externally visible actions.

**Schema-inspection discipline:** the table/column names throughout this document were read from migration SQL and cross-checked against a second production checkout — they are repository anchors, not proof of live database state. Before any write, inspect `information_schema.tables`/`.columns`/`.table_constraints` (or the equivalent live check) to confirm the object actually exists and matches, especially for anything added by an additive `sql/neon_fixes/*` migration, since those aren't guaranteed applied everywhere:
```sql
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public' and table_name = $table
order by ordinal_position;
```

**Source precedence when materials disagree:** (1) live database row/constraint, (2) deployed service/API behavior and verified logs, (3) repository code on the intended branch, (4) migrations verified applied, (5) this playbook, (6) older prompt inventories/handovers as intent/regression evidence only. The repo already carries several of those older documents worth consulting by topic rather than re-deriving: `docs/TALENTOS_PLUGIN_PROMPT_LIBRARY.md` (the original request inventory this playbook was built from), `MASTERPROMPT_ACTIVE_CANDIDATE_JOB_PIPELINE.md` and `ACTIVE_BASE_RESUMES_JOB_MATCHING_MASTERPROMPT.md` (job-matching context), `docs/integrations.md` (Gmail/external integration routes), `docs/neon-safe-migration-runbook.md` (migration safety), `docs/security-matrix.md` (role/privacy boundaries), `QA_CHECKLIST.md` (regression checklist). Don't delete or overwrite them — update only on an explicit documentation-consolidation request.

### Goal / Scope / Evidence / Decision / Action / Verification template

Apply this five-part structure to every command in Sections 14 and 21:

- **Goal** — the business outcome, one sentence.
- **Scope** — environment, candidate/AE/application IDs, time window + timezone, read-only vs. reversible vs. destructive, which systems may be written (Neon, SharePoint, CRM, Gmail, GitHub, Cloudflare, browser extension).
- **Evidence-first** — the authoritative tables to read before recommending anything (named explicitly per command below). Never decide from a derived score alone, a stale dashboard count, a UI badge, or an unverified AI summary.
- **Decision rule** — compare the actual job description to the actual tailored resume; check hard blockers; verify wording is truthful; check for duplicates. Scores (`candidate_job_match_decisions.score`, `ats_score`, `truth_score`) are supporting evidence, never the sole decision.
- **Action rule** — dry-run first for bulk actions; produce exact candidate/application IDs and proposed mutations; confirm before destructive or externally visible writes; use `automation_idempotency_key` for retries; dedupe by the DB's own `(candidate_id, job_id)` unique constraint.
- **Verification rule** — after every write, confirm affected row count, exact IDs changed, before/after state, an `application_stage_history` or `audit_logs` row, and that no unexpected candidate/application changed. On mismatch, stop and report.

### Model policy
- Cheap route (configured low-cost model, e.g. Gemini 2.5 Flash-Lite) for triage, classification, extraction, deduplication, first-pass matching.
- Premium route (e.g. Gemini 2.5 Pro) only for high-value resume/JD adjudication, prompt evaluation, or low-confidence conflicts.
- Provider keys and routing live in `ai_api_keys` / `ai_task_category_config` (the real AI Control Center, `007_ai_control_center_schema.sql`) — every AI agent's model, priority, and health status is queryable there, not hand-maintained separately.
- All AI output is schema-validated; invalid JSON is repaired via a constrained prompt or rejected — never partially overwrites a resume or stage.

### Privacy and security baseline
- Never place database URLs, OAuth client secrets, API keys, temporary passwords, or private mailbox content in prompts, logs, commits, or user-facing reports.
- Candidate portal users view approved resume previews; they cannot download source or tailored resumes.
- Personal mailbox content unrelated to recruiting is suppressed from AI processing and staff views.
- The repo's own playbook is explicit on this point: **"Never use raw SQL, secrets, API keys, or direct database credentials in Codex or an external prompt. Use TalentOS pages, the MCP Command Center, and authenticated application APIs."** Treat this agent's direct-DB access as a privileged, audited exception for manager/admin-scoped operations (like Akash's reports), not a pattern to hand to every AE.

---

## 4. Source, freshness & deduplication logic

The **primary, actively-used ingestion path** is the Apify job-agent pipeline (Section 2: `job_agent_configs`/`job_agent_runs`/`job_agent_staged_jobs`), not the older `import_sources`/`import_runs` pair (`greenhouse|lever|ashby|usajobs|career_page`) from the initial schema — that pair still exists and may still be wired up somewhere, so confirm which is live in the target environment rather than assuming.

1. Run/inspect `job_agent_runs` for the configured `job_agent_configs` (respecting `budget_per_day_usd`, `role_groups`, `is_active`).
2. Staged rows land in `job_agent_staged_jobs` first — normalized title/company/location/salary, `is_remote`, `role_group`/`seniority_guess`, `tier`/`relevance_score`, `ai_keywords`.
3. Deduplicate at the staging layer via `dedup_hash`/`is_duplicate` before promotion, then again at the `jobs` table via `jobs.external_job_id`, canonical `source_url`, or the `job_duplicates` table (`canonical_job_id`, `duplicate_job_id`, `similarity_score`, `resolved`). A staged row's `is_false_positive` flag should also gate promotion.
4. Only rows with `import_status` indicating a successful promotion carry a real `imported_job_id` (→ `jobs.id`); don't treat a staged row as a live job until that link exists.
5. Prefer the newest valid copy among duplicates.
6. Default eligible window: `posted_at` within the last 7 days (`candidate_job_match_runs.freshness_days`, default 7, configurable 1–30). If the user specifies a custom period, use it exactly — report older jobs separately.
7. Exclude: expired/inactive roles (`jobs.is_active = false`), obvious job alerts, promotional "great fit" messages, duplicate/false-positive staged postings, roles missing essential data, roles clearly unrelated to the candidate's approved lanes (`base_resumes.target_roles`, candidate search-profile rules).

---

## 5. Matching & scoring (real engine: `candidate_job_match_runs` / `candidate_job_match_decisions`)

For every active candidate (`candidates.status = 'active'`):
1. Load every active base resume (`base_resumes.status`, scoped by `candidate_id`).
2. Match every eligible job separately against each base resume via a `candidate_job_match_runs` row — never collapse distinct resume lanes into one score.
3. The engine writes one `candidate_job_match_decisions` row per (run, candidate, base_resume, job) with:
   - `score` — **integer, 0–100** (not a 0–10 decimal; that scale was illustrative in the original spec, not what's implemented).
   - `tier` — `'A'` when `score >= tier_a_min` (default 85), `'B'` when `score >= tier_b_min` (default 70), else untiered/rejected.
   - `outcome` — `'recommended'` or `'rejected'`.
   - `hard_gates jsonb` — the blockers that forced rejection regardless of score.
   - `score_breakdown jsonb`, `matched_terms jsonb`, `dismissed_term_hits jsonb` — the evidence trail.
4. `max_recommendations_per_candidate` caps at 50 — this is where Goal 4 ("20–50 strong opportunities per candidate") is actually enforced in code, not just policy.
5. Runs default to `mode = 'dry_run'`; promoting to `mode = 'ae_review'` is the actual "send to AE" action — treat that transition as requiring confirmation like any other bulk write.

### Human ROI rubric (for AE/manager judgment on top of the automated score — from `AE_APPLICATION_ENGINEER_PLAYBOOK.md`)
Use this when a human (an AE, or Akash reviewing what an AE flagged) needs to prioritize by hand, not just trust the automated tier:

| Factor | Points |
|---|---:|
| Posted within 3 days | +20 |
| Posted within 7 days | +12 |
| Direct role-family match | +25 |
| Strong evidence for most must-have requirements | +20 |
| Correct location/remote/authorization fit | +10 |
| Tailored resume complete and truthful | +10 |
| Employer/recruiter signal or realistic conversion path | +10 |
| Clear application route and no duplicate | +5 |
| Requires an unsupported certification/clearance | −30 |
| Experience threshold clearly exceeds candidate rule | −30 |
| Role is materially outside the base resume | −25 |
| Generic alert/marketing/"great fit" language, no real role | −25 |
| Duplicate application or stale posting | −40 |

80–100 = apply today; 65–79 = apply if no blocker; 50–64 = manager/AE judgment, don't mass-apply; below 50 = usually ignore. **A high numeric score never overrides a hard exclusion.**

Reject or hold when: required experience materially exceeds the candidate's limit; the role is clearly junior or senior beyond target; location conflicts with an explicit constraint; the candidate lacks a mandatory credential; the role is unrelated to the base resume; the job is stale; the description is too incomplete to judge.

---

## 6. Classification taxonomy

The original eight-category taxonomy (`APPLY_RECOMMENDATION` / `AE_REVIEW_REQUIRED` / `LOCATION_CONFIRMATION` / `REMOTE_STATUS_CONFIRMATION` / `RESUME_LANE_CONFIRMATION` / `HOLD` / `REJECT` / `DUPLICATE`) is a useful **reporting vocabulary**, but the database itself expresses these states through combinations of real fields. Map outward-facing classification to real fields like this:

| Reporting label | Real DB signal |
|---|---|
| `APPLY_RECOMMENDATION` | `candidate_job_match_decisions.outcome = 'recommended'` AND `tier = 'A'`, no `hard_gates` |
| `AE_REVIEW_REQUIRED` | `decisions.review_status = 'pending'` (run promoted to `mode = 'ae_review'`) |
| `LOCATION_CONFIRMATION` | a location-related entry present in `hard_gates` or `score_breakdown` |
| `REMOTE_STATUS_CONFIRMATION` | `jobs` has ambiguous/missing remote status parsed into `parsed_description` |
| `RESUME_LANE_CONFIRMATION` | more than one `base_resume_id` scored `tier = 'A'/'B'` for the same job — needs a human pick |
| `HOLD` | `applications.priority` unset/low and `review_status = 'pending'` with no due date |
| `REJECT` | `decisions.outcome = 'rejected'` |
| `DUPLICATE` | blocked by the `applications (candidate_id, job_id)` unique constraint, or flagged in `job_duplicates` |

Each returned match still carries: score, classification, matching base resume, three strongest evidence points (`matched_terms`), three risks/missing facts (`hard_gates`/`dismissed_term_hits`), location/remote assessment, freshness assessment (`posted_at` vs `freshness_cutoff`), recommended next action.

---

## 7. Candidate-specific rule examples

Read the candidate's additional rules before scoring — stored per base resume via `candidate_resume_search_profiles` (approved keywords, dismissed keywords, additional rules) referenced by `candidate_job_match_decisions.profile_id`. Examples straight from the repo's live candidate playbooks: "Avoid roles requiring more than five years of experience." / "Prefer Dallas; do not relocate except for exceptional roles." / "Prefer remote or Georgia." / "Reject roles requiring frequent travel." / "Do not target junior CAD roles for a senior program manager." / "Do not use electrical-utility roles for a fiber-OSP resume unless the candidate approved that lane." / (real, live example) Avirup's three lanes — CAD, GIS, OSP — must never be merged; Bhaskar's CAD/Mechanical/OSP lanes the same.

---

## 8. Resume handling & tailoring rules

For each recommended role:
1. Select the correct base resume (`applications.base_resume_id`).
2. Create or reuse a tailored resume version (`application_resume_versions`, keyed by `target_job_id`).
3. Tailor only from verified candidate evidence (`candidate_evidence` table: `source_type`, `title`, `related_skills`, `confidence_score`).
4. Preserve unconditionally: employment history, education, dates, personal information, certifications, factual metrics.
5. Tailorable: summary, headline, skills ordering, accomplishment emphasis, keywords, role-specific terminology — tracked per-change in `application_resume_suggestions` (`suggestion_type`, `truth_status: verified|unverified|fabrication_risk`, `status: pending|accepted|rejected|applied`).
6. Validate before export: no missing roles/education, no fabricated claims, no changed dates, no empty sections; `ats_score`/`truth_score`/`one_page_fit_score` all populated and in range.
7. Export through Falood Studio (the existing renderer — single source of truth for PDF generation/preview; see `src/lib/falood/clientExport.tsx`).
8. Store the exported PDF via `application_resume_exports`, named from `candidate_name_snapshot` + `company_name_snapshot` + `job_title_snapshot` + application ID.
9. Persist: `application_id`, `resume_version_id`, `content_sha256`, `storage_provider`, `storage_item_id`/`storage_url`, `created_by`, `status`.

Use the unique `(application_id, resume_version_id, export_type, content_sha256)` index so retries don't create duplicate files. If the storage write fails, `status = 'failed'` stays retryable and surfaces the error — never silently drop the render.

---

## 9. AI pipeline rules & hardening

Every new application starts life at `application_stage = 'in_ai_pipeline'` and gets exactly one `application_ai_workflows` row (enforced by its partial unique index on `idempotency_key`).

The pipeline runs the real four-agent sequence (`ai_agent_configs`, Section 2), each a row in `application_ai_stage_runs` writing to `application_ai_artifacts`:

1. **Job Lens** (`application_job_lens` → `JobAnalysisV1`) — validate/analyze the job.
2. **Resume Forge** (`application_resume_forge` → `ResumeDraftV1`, `approval_policy: risk_based`) — select/generate the tailored draft into `application_resume_versions`.
3. **Hiring Panel** (`application_hiring_panel` → `ReviewScoreV1`, `minimum_score: 6.0` on the 0–10 scale) — writes `application_resume_versions.ats_score`/`truth_score`.
4. **Final Polish** (`application_final_polish` → `FinalResumeV1`) — final QA pass, `one_page_fit_score`/`page_fit_metrics`.

Then: save AI findings (`application_packets.ai_summary`, `checklist`, `warnings`), save export metadata (`application_resume_exports`), transition `application_stage → 'ready_for_review'`. Copilot agents (browser-extension side, `src/lib/ai/copilot*`) are a **separate** system — do not touch them under a "fix the four pipeline agents" scope unless explicitly asked.

Hardening rules (apply to `application_ai_workflows`/`_stage_runs`/`_artifacts` and the four agents in `src/lib/ai/application-agents/`, each with a `schemas.ts` for structured output — never touch unrelated agents under this scope):
- Use the configured low-cost model unless the task explicitly needs a premium one (route via `ai_task_category_config` / the `ai_agent_configs.provider`/`model` actually stamped on the stage run).
- Enforce structured output via provider-native JSON schema where available; otherwise parse defensively — strip code fences, validate required fields, reject malformed/empty output.
- Never call string methods (e.g. `.toLowerCase()`) on unknown/untyped values; normalize only after type guards.
- Keep the two scoring scales straight (Section 2): Hiring Panel's `ats_score`/`truth_score`/`minimum_score` are 0–10 decimals; `candidate_job_match_decisions.score` is a 0–100 integer. Both must be numeric, finite, and in their own declared range.
- On failure: `application_ai_stage_runs.status = 'failed'` with `error_code`/`error_message` persisted, `application_ai_workflows.last_error` set, the claim released, the application kept recoverable, a Retry action exposed via a new `attempt_number` — never silently continue.
- Never mark a workflow `completed` unless every required `application_ai_artifacts` row exists and passes validation (`application_packets.checklist`).
- Test matrix: success, malformed JSON, missing fields, empty output, duplicate retry (idempotency key must reject it), provider timeout, partial artifact, concurrent retry.

---

## 10. Stage transitions & audit — corrected against `20260813_application_stage_canonicalization.sql`

Canonical field: `applications.application_stage`, values are **lowercase snake_case**, not the uppercase set in the original spec:

```
in_ai_pipeline, ready_for_review, ready_for_application,
applied, screening, interview, offer, rejected,
withdrawn, on_hold, closed
```

| Stage | Meaning | Action |
|---|---|---|
| `in_ai_pipeline` | AI is generating/validating the packet | wait, inspect errors, or retry |
| `ready_for_review` | packet exists, needs human quality review | read job, score, findings, tailored resume |
| `ready_for_application` | human review passed | confirm final packet and submit |
| `applied` | submission completed/verified | record applied time, evidence, follow-up |
| `screening` | employer screening known | add interview/screening details |
| `interview` | interview scheduled/confirmed | capture date, interviewer, prep notes |
| `offer` | offer confirmed | preserve exact terms, escalate to manager |
| `rejected` | employer rejection confirmed | record source/date, don't infer from silence |
| `withdrawn` | candidate/team withdrew intentionally | record reason |
| `on_hold` | deliberately paused | add next-review date |
| `closed` | no further action expected | preserve final reason |

Every transition records (in `application_stage_history`): `application_id`, `from_stage`, `to_stage`, `changed_at`, `changed_by_user_id`, `changed_by_name`, `reason`, `source`. Updates should also refresh `applications.application_stage_changed_at/_by_user_id/_by_name` so the row and the history agree. Never delete an application merely because it leaves the current queue view — that's `closed`/`withdrawn`, not a `DELETE`.

**Critical data-quality caveat, straight from the repo's own executive report**: `applications.ae_reviewed_at`/`ae_applied_at`-style stamped columns (`ae_stage_updated_*`, `ae_applied_by_*`) include legacy/migration-backfilled timestamps and will **overstate** current throughput if counted directly. For any executive-facing count, filter `application_stage_history` to `source = 'queue'` and exclude `source = 'migration'` rows. This exact caveat is why Section 21.3 exists as its own command instead of a naive `COUNT(*)` on the stamped columns.

Legacy `applications.status` and `applications.ae_stage` remain populated in parallel for backward compatibility — read them for migration verification only, never write them going forward.

---

## 11. AE workflow

An AE may: accept or reject a match recommendation, edit notes, change owner (`assigned_to_user_id`), approve a resume (`application_packets.approved_by/approved_at`), move the stage, mark `applied` (`ae_applied_by_user_id/_name/_at`), add a reason, request regeneration. `application_packets.final_resume_version_id` is preserved permanently once `packet_status = 'sent'`.

---

## 12. Email workflow (Gmail)

OAuth via `integration_accounts` (`provider = 'gmail'`, `owner_type: profile|candidate|shared_application_mailbox`, least-privilege `scopes text[]`, `access_token`/`refresh_token`, `status: active|revoked|error`, `last_synced_at`). `integration_oauth_states` holds the pending OAuth handshake state.

Sync tables: `email_logs` (sent/tracked template sends), `email_queue` (scheduled sequence sends), `candidate_messages` (`direction`, `channel`), plus the Gmail-specific inbox tables added in `046_email_triage_and_gmail_sync.sql` / `073_gmail_inbox_log_and_indexes.sql` / `074_gmail_full_backfill.sql` / `082_gmail_sender_rules.sql` / `083_gmail_attachments_and_push.sql` (read those migrations directly before building sync logic — they postdate the initial schema and weren't fully enumerated here).

Classification: recruiter, hiring manager, interview, application confirmation, rejection, offer, job alert, promotional, personal, unknown. Ignore personal and promotional. For relevant email: link to candidate/application, create/update notes, update `application_stage` only when confidence is sufficient, star recruiter/interview/hiring messages if authorized, push discovered recruiter/hiring-manager contacts into `crm_contact_sync_queue`.

Do not automatically reject a candidate from ambiguous email. Do not mark an invitation resolved unless a sent response exists or an AE manually takes over. Low-confidence stage changes require human review.

---

## 13. Command / MCP tool surface

`inspect_candidate` · `list_active_candidates` · `list_candidate_base_resumes` · `inspect_application_queue` · `search_applications` · `search_recent_jobs` · `search_jobs_for_candidate` · `rank_jobs_for_candidate` · `explain_match` · `find_duplicate_application` · `create_application_draft` · `run_application_pipeline` · `get_pipeline_status` · `retry_pipeline` · `reconcile_pipeline` · `get_tailored_resume` · `audit_resume_integrity` · `manage_base_resume_search_profiles` · `get_sharepoint_export` · `list_stage_transitions` · `update_application_stage` · `repair_application_state` · `assign_application_owner` · `get_ae_daily_summary` · `get_candidate_email_sync_status` · `run_email_sync` · `triage_candidate_email` · `match_email_to_application` · `extract_interviews` · `sync_recruiter_contacts` · `generate_candidate_report` · `backup_application_logs` · `delete_or_restore_application_logs` · `run_browser_fixture` · `verify_deployment` · `export_audit_csv` · `audit_repositories` · `prepare_commit_and_deploy`

**Akash/manager-facing additions (Section 21):** `identify_high_roi_roles` · `assign_application_to_ae` · `ae_application_report` · `ae_tailoring_quality_report` · `ae_bandwidth_snapshot` · `akash_daily_digest`

All tools default **read-only**. Confirmation is required before: creating an application, changing `application_stage`, assigning an owner, deleting a record, sending email, modifying a resume, writing to SharePoint.

Every command supports, where applicable: `dry_run`, `candidate_id`, `application_ids`, `ae_user_id`, `time_window`, `timezone`, `actor`, `reason`, `idempotency_key`, `verification_level`.

---

## 14. Command prompt library (candidate/job side — full detail)

Each follows the Section 3 template; original user quotes kept as regression-test examples.

### 14.1 `audit_repositories` — Repository, deployment, and handover
**Goal:** reproducible, multi-developer operation with zero drift. **Scope:** repo path/branch/environment. **Evidence:** current branches, latest commits, working-tree diffs, deployment targets, drift between local/GitHub/production. **Decision:** never overwrite unrelated work; warn before invoking any script that broadly kills/restarts processes. **Action:** show changed files + tests before pushing; branch unless direct production-branch work is explicitly authorized. **Verification:** confirm the remote commit landed and matches; report exact hash and deployment status.

### 14.2 `inspect_application_queue` — Application queue and stage workflow
**Goal:** one reliable lifecycle where every dashboard and queue agrees. **Scope:** `applications.application_stage` as canonical. **Evidence:** every writer/reader of stage — queue filters, bulk actions, reassignment, extension actions, AI finalization, email updates, dashboards, counters, exports, APIs. **Decision:** stuck-in-pipeline/inconsistent rows get reconciled, not deleted. **Action:** verify/extend `application_stage_history` writes on every transition; rolling filters (12h/24h/3d/7d/custom) against `applied_at`/`application_stage_changed_at`; pagination applied after filtering; verify `assigned_to_user_id` reassignment persists in DB and UI. **Verification:** do not drop `applications.status`/`ae_stage` until every reader/writer is migrated and regression-tested.

### 14.3 `run_application_pipeline` / `retry_pipeline` — AI application pipeline
**Goal:** a pipeline that never silently corrupts or half-finishes an application. **Scope:** the specific agent(s) in `src/lib/ai/application-agents/` — no unrelated agent touched. **Evidence:** trace input → prompt → model → `schemas.ts` → parser → DB write → retry path → stage transition. **Decision:** apply Section 9 hardening in full. **Action:** find applications not yet at `ready_for_review`/`ready_for_application` that should be, re-enqueue via `automation_idempotency_key` (dry-run list first). **Verification:** run the full failure-mode test matrix before declaring fixed.

### 14.4 `manage_base_resume_search_profiles` — Base-resume job-search profiles
**Goal:** relevant job ingestion without keyword flooding. **Scope:** every active candidate × active base resume. **Evidence:** `candidate_resume_search_profiles`, `job_keywords`, `keyword_approvals` — the resume content itself, not scores. **Decision:** 10–48 high-signal terms grouped by target title/core skill/adjacent title/domain, deduped case-insensitively. **Action:** on regen, atomically replace only that base resume's AI proposal set, preserve manager-dismissed terms (`keyword_approvals.decision`), store model/prompt version/timestamp/error state. **Verification:** dismissed-terms list unchanged, term count in bounds, no orphaned "working" rows.

### 14.5 `rank_jobs_for_candidate` — Job ingestion and candidate matching
**Goal:** every eligible recent job with a real shot at an interview, per active candidate. **Scope:** candidate(s), `freshness_days` (default 7). **Evidence:** `jobs`, `candidate_job_match_runs`/`decisions`, `applications` (dedup), candidate rules. **Decision:** rank by `score`/`tier`, not score alone — respect `hard_gates`; never duplicate `(candidate_id, job_id)`. **Action:** produce a review table before creating records; on approval, `mode: 'ae_review'` promotes decisions, then `create_application_draft` with idempotency key. **Verification:** every created application has exactly one active pipeline run; no duplicate pairs (DB constraint enforces this, but verify anyway).

### 14.6 `audit_resume_integrity` — Tailored-resume quality audit
**Goal:** catch inaccurate/generic/low-ROI resumes before an AE chases them. **Scope:** one or more applications. **Evidence:** the job's `description_text`, the exact `application_resume_versions.content` attached via `application_packets.final_resume_version_id`, and the verified `base_resumes`/`candidate_evidence` — never `ats_score` alone. **Decision:** classify each requirement supported/adjacent/unsupported/blocker; cross-check employers, dates, titles, degrees, certifications against source; flag anything in `application_resume_suggestions.truth_status = 'fabrication_risk'`. **Action:** recommend keep/high-priority/human-review/delete with a reason; never mutate during analysis. **Verification:** backup via `export_audit_csv` before any approved delete/priority change.

### 14.7 Gmail sync, triage, extraction — see Section 12 for the schema; command template identical to Section 3.

### 14.8 Candidate portal and dashboard (read/report only for this agent)
Candidates get streamed/signed previews (never raw storage URLs); paginated applications; interview timeline; 24h/7d/monthly charts; portal auth via `candidates.portal_token`/`portal_token_expires_at`/`portal_token_revoked_at`.

### 14.9 `get_sharepoint_export` — Resume PDF, Studio, and SharePoint export
See Section 8 — `application_resume_exports` is the full record; Falood Studio is the single renderer.

### 14.10 `sync_recruiter_contacts` — CRM recruiter and hiring-manager enrichment
**Goal:** grow a clean, provenance-tracked contact base without pollution. **Scope:** recruiting-related email threads only. **Evidence:** `crm_contact_sync_queue` (pending/failed rows), `company_people` (internal directory). **Decision:** never create contacts from personal/marketing/spoofed mail; classify `recruiter|hiring_manager`. **Action:** dedupe by normalized email first (`UNIQUE(candidate_id, contact_email)` already enforces this at the DB level); process the outbox respecting `next_attempt_at`/`attempts`. **Verification:** never overwrite a verified `company_people` field with weaker evidence.

### 14.11 Reporting — superseded by Section 21 for AE-specific reporting; general candidate/job reporting follows the same evidence-first, `source='queue'`-filtered pattern.

### 14.12 `backup_application_logs` / `delete_or_restore_application_logs`
**Goal:** destructive ops that are always backed up and reversible until confirmed complete. **Scope:** exact record IDs resolved first. **Evidence:** CSV/JSON backup of application IDs, candidate/job refs, stage, priority, owner, resume IDs, timestamps. **Decision:** transaction/recoverable archive; delete dependents in FK-safe order (exports → suggestions → packets → stage_history → application). **Verification:** confirm target IDs absent, unrelated records intact, backup readable.

### 14.13 `run_browser_fixture` — Extension and browser fixtures
Greenhouse, Lever, Workday, Ashby, Zoho, Indeed, LinkedIn, generic forms. Signed context: application ID, candidate ID, job ID, candidate name, company, `application_resume_versions.id`, source URL. Never trust an undefined global or arbitrary page text; schema-validate form analysis.

### 14.14 `prepare_commit_and_deploy` / `verify_deployment`
Small reviewable branches over direct production commits; confirm CI green, commit present on remote, post-deploy health check before declaring done.

---

## 15. Security, secrets & least privilege

- Never embed database credentials in prompts. Never return API keys (`ai_api_keys.encrypted_key` stays encrypted at rest; only `key_fingerprint` is safe to display).
- Use environment variables or a secret store; use scoped MCP API keys (`public_api_keys`: `key_prefix`, `key_hash`, `scopes text[]`, `revoked_at`).
- Log tool caller, timestamp, operation, and affected IDs for every write — `audit_logs` is the real table for this (`actor_user_id`, `action`, `entity_type`, `entity_id`, `metadata`).
- Restrict candidate-mailbox access to approved `integration_accounts` rows only.
- Redact personal email content from AI outputs.
- Least privilege even where the DB is technically fully accessible — every query still scoped to the task at hand. The repo's own AE playbook explicitly forbids AEs from running raw SQL/using credentials directly; this agent's direct-DB access is a manager/admin-level exception, not a pattern to generalize.
- Prefer a read-only database role for inspection; use parameterized queries only, never string-concatenated SQL.
- Do not expose a generic unrestricted SQL tool to an AI agent generally — narrowly-scoped parameterized operations, or a read-only role with query logging, are the safe pattern. Section 21's queries are written as reference SQL for a human/agent with vetted read access, not as an open query box to hand an AE.

### Runtime configuration contract
Supply these through secure runtime configuration — **never** hard-code or print values, only reference by name: repository URL/branch/deployment target/production base URL; `DATABASE_URL` or equivalent; cron/MCP secrets; AI provider/model routing config; Gmail OAuth client/redirect URI/scopes; SharePoint storage and CRM configuration; authorized manager/admin identities (e.g. Akash's `profiles.user_id`); candidate privacy/retention/resume-preview policy. Refuse a production mutation when a required secret is missing, scope can't resolve to stable IDs, the branch has unrelated unreviewed edits, or the database/runtime target is ambiguous (see the dual-backend note at the top of this document).

---

## 16. Daily run orchestration

1. Pull fresh jobs (respect `import_sources.is_active`).
2. Apply `freshness_days`.
3. Normalize and dedupe (`job_duplicates`, `external_job_id`).
4. Load active candidates (`status = 'active'`).
5. Load active base resumes.
6. Run `candidate_job_match_runs` (`mode: 'dry_run'` first) → `candidate_job_match_decisions`.
7. Remove duplicates/weak matches (`outcome = 'rejected'`, `hard_gates`).
8. Rank by `tier`/`score`, remote/approved-location fit, freshness, `ats_score` confidence, urgency.
9. Generate tailored resumes for approved candidates (`application_resume_versions`).
10. Promote strong runs to `mode: 'ae_review'`; create `applications` at `application_stage = 'in_ai_pipeline'`.
11. Move successful pipeline runs to `ready_for_review`.
12. Notify AEs/Akash of high-priority items (Section 21.1/21.6).
13. Produce a daily summary: jobs ingested, jobs rejected, matches found, applications created, pipeline successes/failures, AE-review pending, AE-applications completed, export failures, duplicates prevented.

---

## 17. Output schemas

### Match-run output (corrected to the real 0–100/tier scale)
```json
{
  "run_id": "candidate_job_match_runs.id",
  "candidate_id": "string",
  "window": { "posted_after": "ISO timestamp", "posted_before": "ISO timestamp" },
  "matches": [
    {
      "job_id": "string",
      "application_id": "string or null",
      "base_resume_id": "string",
      "title": "string",
      "company": "string",
      "location": "string",
      "remote_status": "remote|hybrid|onsite|unknown",
      "posted_at": "ISO timestamp",
      "score": 87,
      "tier": "A|B|null",
      "outcome": "recommended|rejected",
      "hard_gates": [],
      "evidence": [],
      "risks": [],
      "recommended_action": "string"
    }
  ],
  "duplicates": [],
  "held": [],
  "rejected": [],
  "errors": [],
  "next_actions": []
}
```

### Stage-transition audit record
`application_id`, `from_stage`, `to_stage`, `changed_at`, `changed_by_user_id`, `changed_by_name`, `reason`, `source`.

### Export record
`application_id`, `resume_version_id`, `content_sha256`, `candidate_name_snapshot`, `company_name_snapshot`, `job_title_snapshot`, `storage_provider`, `storage_item_id`, `storage_url`, `status`, `created_by`, `created_at`.

---

## 18. Master orchestration system prompt

Use this as the plugin's top-level system prompt / skill entry point:

> You are the TalentOS Operations Agent. You operate a recruiting workflow that stores candidates, base resumes, jobs, applications, tailored resumes (`application_resume_versions`), match runs/decisions, application packets, resume exports, Gmail integration accounts, interviews, CRM contact sync, stage history, and audit logs — the real schema in `neon/migrations/` and `sql/neon_fixes/`, not an idealized one.
>
> Your objective is to improve interview conversion while preserving factual accuracy, candidate privacy, workflow continuity, and traceability.
>
> Before acting:
> - Discover the repository, branch, deployment target, current database schema, and available service routes — migrations land ahead of this document, so re-verify column names against `sql/neon_fixes/` before trusting them.
> - Resolve names to stable UUIDs (`profiles.user_id`, `candidates.id`, `applications.id`) before making changes.
> - Use `applications.application_stage` for workflow state. Treat `status` and `ae_stage` as read-only migration evidence.
> - Never invent an employer, title, interview, resume fact, score, or email outcome.
> - Never expose secrets, OAuth tokens, message bodies, or private resume URLs in logs.
> - Suppress personal, transactional, promotional, shopping, delivery, banking, and unrelated email from recruiting action queues.
>
> For every task: state scope and assumptions → inspect current state → dry-run summary before destructive/bulk writes → execute only the approved scope → verify by querying the database → report counts, IDs, stages, errors, rollback info.
>
> When AI is used: cheap model for routine classification/extraction, premium only for high-value adjudication (route via `ai_task_category_config`); require structured JSON validated against `schemas.ts`; retry malformed output with a constrained repair prompt, then fail safely; never treat a score as valid outside its declared range (0–100 for match decisions, numeric for `ats_score`/`truth_score`/`one_page_fit_score`).
>
> For stage changes, write only `application_stage`, insert an `application_stage_history` row (`from_stage`, `to_stage`, `changed_by_user_id`, `source`, `reason`), and let dependent dashboards read through the same tables. For email, use least privilege, cursor-based incremental sync, provider IDs, privacy suppression, human review for low-confidence actions. For resumes, preserve source facts, link every `application_resume_versions` row to its `application_packets` and `base_resume_id`, persist export metadata with `content_sha256` idempotency. For jobs, dedupe via the DB's own `(candidate_id, job_id)` constraint and `job_duplicates`, respect `freshness_days` and candidate rules, and never create more than one active pipeline run per new application.
>
> Always finish with: what was inspected, what changed, counts before/after, IDs affected, tests/checks run, unresolved risks, and whether a commit/deployment was made. Do not claim success without a database or API verification result.

---

## 19. Original request inventory (regression-test corpus)

Kept as test cases the improved commands in Sections 14 and 21 must still satisfy — see each command's opening for the literal original asks; not repeated here to avoid duplication.

---

## 20. Suggested repo layout for the skill / plugin

```
talentos-ops-agent/
├── plugin.json
├── SKILL.md                     # entry point → Section 18 master prompt
├── commands/
│   ├── audit_repositories.md
│   ├── inspect_application_queue.md
│   ├── run_application_pipeline.md
│   ├── manage_base_resume_search_profiles.md
│   ├── rank_jobs_for_candidate.md
│   ├── audit_resume_integrity.md
│   ├── sync_candidate_gmail.md
│   ├── get_sharepoint_export.md
│   ├── sync_recruiter_contacts.md
│   ├── backup_application_logs.md
│   ├── run_browser_fixture.md
│   ├── identify_high_roi_roles.md      # Section 21.1
│   ├── assign_application_to_ae.md     # Section 21.2
│   ├── ae_application_report.md        # Section 21.3
│   ├── ae_tailoring_quality_report.md  # Section 21.4
│   ├── ae_bandwidth_snapshot.md        # Section 21.5
│   └── akash_daily_digest.md           # Section 21.6
├── schemas/
│   ├── match_run.schema.json
│   ├── stage_transition.schema.json
│   └── export_record.schema.json
└── README.md
```

---

## 21. Akash / AE-Manager Command Center

Built specifically for **Akash, who runs the AE department**: he needs to see high-ROI roles as they surface, assign them to the right AE, and get reporting he can actually trust on volume *and* quality per AE. Every query below is adapted from real tables and, where one already exists, the repo's own reproducible report definitions (`EXECUTIVE_AE_BANDWIDTH_REPORT_2026-08-11.md`) rather than invented from scratch.

Resolve Akash's own `profiles.user_id` once (by email, `role IN ('manager','admin')`) and reuse it as `actor` on every write below.

### 21.1 `identify_high_roi_roles` — surface the roles worth chasing right now

**Goal:** give Akash a ranked, de-duplicated list of the strongest open opportunities across all active candidates, refreshed on demand.
**Scope:** all active candidates by default, or a named subset; default freshness 7 days.
**Evidence:** `candidate_job_match_decisions` joined to `jobs`, `candidates`, `base_resumes`, filtered to `outcome = 'recommended'` and `review_status IN ('pending','not_applicable')`, i.e. not already actioned.
**Decision:** rank by `tier` (A before B) then `score DESC`, apply the Section 5 human ROI rubric as a tiebreaker/sanity check, exclude anything with a non-empty `hard_gates` that wasn't already filtered.
**Action (read-only):**
```sql
SELECT d.id AS decision_id, d.candidate_id, c.name AS candidate_name,
       d.base_resume_id, br.name AS base_resume_name,
       d.job_id, j.title, j.company, j.location, j.posted_at,
       d.score, d.tier, d.outcome, d.review_status,
       d.matched_terms, d.hard_gates, d.application_id
FROM candidate_job_match_decisions d
JOIN candidates c ON c.id = d.candidate_id
JOIN jobs j ON j.id = d.job_id
JOIN base_resumes br ON br.id = d.base_resume_id
WHERE d.outcome = 'recommended'
  AND d.review_status IN ('pending', 'not_applicable')
  AND j.posted_at >= now() - interval '7 days'
  AND c.status = 'active'
ORDER BY d.tier ASC, d.score DESC, j.posted_at DESC
LIMIT 100;
```
**Verification:** cross-check a sample against the live job posting (still active, not expired) before Akash acts on the list — a stale `is_active` flag is possible if the crawler stalled.

### 21.2 `assign_application_to_ae` — put a role in front of the right person

**Goal:** get a high-ROI role onto the right AE's plate with a clear owner, due date, and reason.
**Scope:** one or more `application_id`s (promote the `candidate_job_match_decisions` row to an `applications` row first via 14.5 if it doesn't have one yet), target `ae_user_id`.
**Evidence:** `profiles` (`role = 'application_engineer'`, `is_active = true`) for who's eligible; current `applications.assigned_to_user_id`/`assignment_due_at` to avoid silently reassigning someone else's active ticket without a reason.
**Decision:** don't pile onto an AE who is already over capacity — check 21.5 first for current open ownership.
**Action:**
```sql
UPDATE applications
SET assigned_to_user_id = $ae_user_id,
    assigned_by_user_id = $akash_user_id,
    assignment_note = $reason,
    assignment_due_at = $due_date
WHERE id = ANY($application_ids);

INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata)
SELECT $akash_user_id, 'assign_application', 'application', id,
       jsonb_build_object('assigned_to', $ae_user_id, 'reason', $reason)
FROM applications WHERE id = ANY($application_ids);
```
Requires confirmation (Section 3/13 rule: "assigning an owner" is a gated write). Not a stage change by itself — do not also write `application_stage_history` unless the stage is actually moving (e.g. `in_ai_pipeline → ready_for_review` once picked up).
**Verification:** re-read `applications.assigned_to_user_id` for the affected IDs; confirm the UI queue (candidate's "Mine" filter for that AE) reflects it.

### 21.3 `ae_application_report` — how many applications each AE actually did

**Goal:** a trustworthy per-AE count Akash can defend in a meeting, not an inflated one.
**Scope:** rolling or fixed window + timezone (the existing report used `America/New_York` Friday-start and a Bangladesh-local breakdown — support both).
**Evidence — and the caveat that matters most:** `applications.ae_applied_at`/`ae_stage_updated_at` **overstate** throughput because they carry migration-backfilled timestamps landing inside recent windows. **Use `application_stage_history` filtered to `source = 'queue'`, excluding `source = 'migration'`**, exactly as the repo's own report documents.
**Decision:** count distinct `application_id` per `changed_by_user_id`, split "reviewed" (`to_stage = 'ready_for_application'`) from "applied" (`to_stage = 'applied'`); never infer AE productivity from AI/system actors.
**Action (read-only):**
```sql
-- Active AE headcount
SELECT count(*) FROM profiles WHERE is_active = true AND role = 'application_engineer';

-- Per-AE throughput in the window (adjust the interval/timezone as requested)
SELECT h.changed_by_user_id, h.changed_by_name,
       count(DISTINCT h.application_id) FILTER (WHERE h.to_stage = 'ready_for_application') AS reviewed,
       count(DISTINCT h.application_id) FILTER (WHERE h.to_stage = 'applied') AS applied,
       count(DISTINCT h.application_id) AS unique_tickets_touched
FROM application_stage_history h
WHERE h.source = 'queue'
  AND h.changed_at >= $window_start
  AND h.changed_at <  $window_end
GROUP BY h.changed_by_user_id, h.changed_by_name
ORDER BY applied DESC, reviewed DESC;
```
**Verification:** report both the queue-history number (trustworthy) and the stamped-column number (`ae_applied_at` count) side by side with a note on the gap, exactly as the existing executive report does — don't let one silently replace the other without explanation. Watch for duplicate-looking AE identities (the existing report found two accounts both displaying as "Golam" — flag rather than silently merge).

### 21.4 `ae_tailoring_quality_report` — which AE is tailoring best / worst

**Goal:** rank AEs by the measured quality of what they actually shipped, not just volume.
**Scope:** a time window; optionally one AE for a drill-down.
**Evidence:** `application_resume_versions.ats_score` / `truth_score` / `one_page_fit_score`, joined through `application_packets` (`final_resume_version_id`) to `application_packets.reviewed_by` / `approved_by` / `sent_by` — **this is the correct accountability join** (the person who reviewed/approved/sent the packet), not `application_resume_versions.created_by`, which is frequently the system/AI actor for the first draft.
**Decision:** this specific join has not been spot-checked against live data in this session — before publishing a "worst AE" ranking to Akash, run it against 10–20 known applications and confirm the attributed name matches who actually worked the ticket. Treat the first run as a **draft for validation**, not a final leaderboard.
**Action (read-only, pending the spot-check above):**
```sql
SELECT p.user_id, p.display_name,
       count(*) AS packets,
       avg(rv.ats_score)          AS avg_ats_score,
       avg(rv.truth_score)        AS avg_truth_score,
       avg(rv.one_page_fit_score) AS avg_page_fit,
       count(*) FILTER (WHERE rv.truth_score < 0.7) AS low_truth_count
FROM application_packets ap
JOIN application_resume_versions rv ON rv.id = ap.final_resume_version_id
JOIN profiles p ON p.user_id = COALESCE(ap.approved_by, ap.reviewed_by, ap.sent_by)
WHERE ap.updated_at >= $window_start
GROUP BY p.user_id, p.display_name
ORDER BY avg_truth_score ASC, avg_ats_score ASC;
```
Also fold in `application_resume_suggestions.truth_status = 'fabrication_risk'` counts per reviewer as a second, independent quality signal.
**Verification:** never act on this ranking alone — pair a "worst" result with `audit_resume_integrity` (14.6) on a few of that AE's actual applications before any coaching conversation. A low average can also mean that AE was handed the hardest candidates/lanes.

### 21.5 `ae_bandwidth_snapshot` — live version of the existing executive report

**Goal:** reproduce `EXECUTIVE_AE_BANDWIDTH_REPORT_2026-08-11.md` on demand instead of as a one-off hand-built doc.
**Scope:** active AEs (`profiles.role = 'application_engineer'`, `is_active = true`).
**Evidence:** current ownership (`applications.assigned_to_user_id`, grouped by `application_stage`), plus 21.3's throughput query.
**Action (read-only):**
```sql
-- Current open ownership by AE and stage
SELECT p.display_name, a.application_stage, count(*)
FROM applications a
JOIN profiles p ON p.user_id = a.assigned_to_user_id
WHERE p.role = 'application_engineer' AND p.is_active = true
  AND a.application_stage NOT IN ('applied','rejected','withdrawn','closed','offer')
GROUP BY p.display_name, a.application_stage
ORDER BY p.display_name;

-- Unassigned AI-pipeline backlog (the routing problem the last report flagged)
SELECT count(*) FROM applications
WHERE application_stage = 'in_ai_pipeline' AND assigned_to_user_id IS NULL;
```
**Verification:** reconcile the "current queue load" total against `count(*) FROM applications WHERE application_stage NOT IN ('applied','rejected','withdrawn','closed')` so the open-ticket total in the snapshot always ties out to a live count.

### 21.6 `akash_daily_digest` — one composite for the manager

**Goal:** the single thing Akash actually opens each morning.
**Scope:** last 24h / 7d, all active AEs and candidates.
**Action:** compose 21.1 (top 10–20 high-ROI unassigned roles), 21.3 (yesterday's per-AE applied/reviewed counts, `source='queue'` only), 21.4 (rolling 7-day quality averages, flagged low-truth items), 21.5 (current ownership + unassigned backlog), plus a routing-backlog callout whenever unassigned `in_ai_pipeline` count exceeds active-AE-owned count (exactly the imbalance the last manual report caught: 279 unassigned vs. 44 assigned).
**Verification:** every number in the digest must be reproducible by re-running its source query — never hand-summarize without the underlying SQL available on request.

---

## 22. Minimum regression suite

Adapted from the Codex playbook's own checklist — run whichever of these apply before calling a change complete:

- candidate/job/application identity survives queue → AI pipeline → extension context;
- duplicate `(candidate_id, job_id)` creation is prevented (DB constraint) and `application_ai_workflows.idempotency_key` rejects a duplicate workflow;
- only active candidates (`status = 'active'`) and approved base-resume lanes are matched;
- recent-job windows and timezone/date arithmetic are correct against `posted_at`/`freshness_cutoff`;
- `candidate_job_match_decisions.score` stays a finite 0–100 integer and is never the sole decision; `ats_score`/`truth_score` stay finite 0–10 decimals;
- malformed, empty, timed-out, partial, duplicate-retry, and concurrent AI stage runs fail safely (`application_ai_stage_runs.status = 'failed'` with `error_code`);
- employment and education integrity survives tailoring (`application_resume_suggestions.truth_status`);
- a successful workflow creates every required `application_ai_artifacts` row and reaches `application_stage = 'ready_for_review'`;
- failed workflows retain `last_error` and support retry via a new `attempt_number`;
- stage changes persist after reload with actor/time/source/reason in `application_stage_history`;
- `assigned_to_user_id` reassignment persists and dashboards reconcile;
- pagination does not skip/duplicate rows and hidden stages are still counted;
- candidates cannot reach internal routes or download resumes through the portal;
- Gmail backfill/incremental sync is idempotent on `gmail_message_id` and reports progress;
- personal/promotional mail (`email_communications.ai_category`) creates no recruiting task or `crm_contact_sync_queue` row;
- interview extraction and CRM contact upsert are idempotent (`UNIQUE(candidate_id, contact_email)`);
- SharePoint export retains application/tailored-version identity via `content_sha256`;
- backup restore validates foreign keys and duplicate conflicts;
- deployment SHA matches the intended branch and health checks pass.

---

## Next steps

Schema confirmed against commit `d2d2f208ef0574a9e0acedc66e27f88207d4dc12`, then reconciled a second time against the Codex-built playbook in the separate production checkout. Things still needing a live-data check before daily use, especially for Akash:

1. **21.4's attribution join** (`application_packets.approved_by/reviewed_by/sent_by` as "the AE who tailored this") should be spot-checked against 10–20 real applications before any "best/worst AE" ranking is shown to Akash as fact.
2. **Full Gmail sync table set** (Section 2/12) — `email_communications` is now confirmed, but the surrounding tables added in `073`–`083` (attachments, sender rules, push, drafts/handover, approvals) weren't individually read; do that before building `sync_candidate_gmail`/`triage_candidate_email`.
3. **Dual-backend reconciliation** — confirm whether `backend/` (NestJS/TypeORM) is live-serving any of the tables it mirrors, or is a separate/parallel/legacy service, before pointing a write at "the" database.
4. **`ai_agent_configs` provider/model values** are seeded `null` in the migration shown — confirm what's actually configured live before assuming a specific model per agent.

Once those are confirmed: scaffold the actual `plugin.json`/`SKILL.md`/`commands/*.md` files per Section 20 (there's already a bare-bones version at `TalentOS-production/plugins/talentos-ops-agent/` worth extending rather than starting over — its `plugin.json` and `SKILL.md` are a reasonable shell, just thin on the command detail this document now has), and wire read-only DB credentials (via secret store, never in this file) so Sections 21.1/21.3/21.5 can run live rather than as reference queries.
