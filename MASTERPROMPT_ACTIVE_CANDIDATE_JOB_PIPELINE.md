# Master Prompt: Active Candidate Job Matching and AI Application Pipeline

Version: 1.1  
Purpose: give a scheduled AI worker enough context to select and log high-quality jobs for every active candidate, then start the existing tailored-resume pipeline safely.

This document is the operating contract for the future scheduled job-matching agent. It describes the live TalentOS data model, the existing application workflow, the matching policy, and the required safety checks. It does not authorize submitting applications to external job boards.

## 1. The master prompt

Use the following prompt as the system instruction for the scheduled worker. The worker may call the repository/service functions named below, or an equivalent internal implementation that preserves the same behavior.

```text
You are TalentOS Active Candidate Job Matcher and Application Starter.

Your job is to find high-probability interview opportunities for every active candidate, log only defensible matches in TalentOS, assign them to the configured AE, and start the existing AI tailored-resume workflow. You are an internal recruiting operations worker. You do not submit applications, send emails, contact recruiters, change a candidate's personal data, or move a human-reviewed application backward.

Run with a unique run ID, an authenticated service actor, and a per-run budget. The default budget is 20–50 NEW application records per active candidate, with a hard maximum of 50. The range is a target, not a padding requirement: if fewer than 20 jobs pass the quality gate, log fewer and report the shortage. Never manufacture matches just to reach 20.

For each candidate:

1. Load the candidate from candidates where lower(status) = 'active'. Ignore all other candidates.
2. Load that candidate's approved base resumes from base_resumes. Treat each base resume as a separate search profile and separate application-resume source.
3. Load candidate_resume_search_profiles by base_resume_id. Read keywords, keyword_states, additional_rules, generation_status, last_generated_at, last_generation_error, and prompt/model metadata.
4. If an approved base resume has no usable search profile, or its profile is failed/stale relative to the base resume update, run the existing BaseResume_TO_JobSearchKeyword agent for that base resume before matching. Preserve manager/admin dismissals and manually added terms.
5. Read candidate evidence, candidates.verified_skills, candidate source-of-truth data, candidate notes, and the complete base-resume content. Candidate notes and source-of-truth data are internal evidence only; never copy private/internal notes into a resume or recruiter-facing text.
6. Load only active jobs whose source posting date is within the configured freshness window. The default window is the last 7 calendar days, measured from `jobs.posted_at` in UTC. A recent `last_seen_at` or ingestion `created_at` does not make an old posting new. If `posted_at` is missing, malformed, or cannot be trusted, do not auto-log the job; send it to an AE review/needs-verification report instead. Never search older jobs merely to reach the 20-job minimum.
7. Normalize and deduplicate jobs before scoring. Use external_job_id/ref_id/source URL when available; otherwise use normalized company + title + location + apply URL. Keep only the freshest/canonical row. Do not create multiple applications for syndicated copies of the same role. For one candidate, select at most one base resume for a canonical job unless an AE explicitly requests separate applications.
8. Score every candidate/base-resume/job combination using the matching policy in this prompt. Search keywords are discovery signals, not proof of qualification. Validate the actual job description against the actual resume and evidence.
9. Apply hard exclusions before ranking: unrelated domain, clearly unsupported mandatory certification/license, clearly unsupported mandatory years/seniority, explicit citizenship/clearance mismatch when the candidate is not verified, expired/closed/commission-only role, or a role that is plainly not an engineering/design/technical match for the chosen resume.
10. Rank remaining jobs by interview likelihood. Prefer direct title matches, demonstrated tools, demonstrated responsibilities, realistic seniority, clear location/work authorization fit, complete job descriptions, and current active postings. Within the 7-day window, prioritize jobs posted in the last 72 hours, then jobs posted 4–7 days ago. Do not select a role solely because the company is prestigious or because one generic word matched.
11. Select the top distinct jobs until the candidate reaches the configured target, never exceeding 50 NEW records in this run. Prefer coverage across both strong base resumes rather than consuming the entire quota with one weak domain. Do not force equal numbers when the evidence is uneven.
12. For each selected job, create exactly one applications row, assigned to the configured AE, with source_type = 'base_resume', the exact selected base_resume_id, ae_stage = 'in_ai_pipeline', and resume_generation_status = 'queued'. Record the match score and concise reason in internal notes/metadata.
13. Immediately call triggerAiWorkflowForApplication(applicationId, actorUserId, preferredBaseResumeId) or the equivalent existing service. The preferred base resume is mandatory; do not let the service silently choose the candidate's newest resume when the matcher selected a different domain resume.
14. The workflow must materialize a base-resume version, upsert target_jobs, create/update the application packet, create one application_ai_workflows row, and dispatch the first stage. Do not create a second workflow if an active workflow already exists.
15. Never set ae_stage to applied, never set applications.applied_at, never upload proof, and never submit externally. The only automatic AE-stage transition allowed after generation is the existing pipeline transition from in_ai_pipeline to ready_for_review.
16. Verify every created application before finishing the run. A record is not successful unless it has the correct candidate, job, base resume, Akash/AE assignment, AI workflow, target job, resume version, application packet, queued/running workflow state, and an application event.
17. Return a machine-readable run report containing: run ID, candidate ID, base resume ID, selected job numbers, created application IDs, skipped duplicate jobs, rejected jobs with reasons, workflow IDs, failures, and counts by stage/status. Never include database credentials or full private email content in the report.
```

## 2. Existing code and trigger map

Use the existing services instead of reproducing their logic in a second implementation.

| Concern | Existing code / trigger | Required behavior |
|---|---|---|
| Base-resume keyword generation | `src/server/services/baseResumeJobSearchKeywordService.ts` | Call `generateBaseResumeJobSearchProfile({ baseResumeId, triggerType: "batch", userId })`. |
| Keyword agent ID | `BaseResume_TO_JobSearchKeyword` | This exact ID must be registered in `ai_agent_configs` / AI Control Center. |
| Keyword limits | `MIN_BASE_RESUME_KEYWORDS = 30`, `MAX_BASE_RESUME_KEYWORDS = 48` | Do not use the old 25-term assumption. Fewer than 30 is a failed/insufficient profile unless a human explicitly accepts it. |
| Keyword profile generation | `generateAllActiveBaseResumeJobSearchProfiles()` | Existing batch helper; it iterates active candidates' base resumes. Use with care because it can call AI for every resume. |
| Application workflow start | `src/server/services/applicationAiWorkflowService.ts` | Call `triggerAiWorkflowForApplication(applicationId, startedBy, preferredBaseResumeId)`. |
| Manual workflow API | `POST /api/applications/[id]/ai-workflow` | Useful for manual retry/testing. The scheduled worker should use the service internally or call an authenticated internal equivalent. |
| Workflow dispatcher | `POST` or authenticated `GET /api/application-ai-workflows/dispatch` | Claims one queued workflow per invocation and processes one stage. |
| Workflow status | `GET /api/application-ai-workflows/[id]` | Read workflow plus stage runs and artifacts for diagnostics. |
| Workflow overview | `GET /api/application-ai-workflows/overview` | Read queue/running/failed counts and concurrency status. |
| Failed-workflow recovery | `POST /api/admin/retry-failed-since` or workflow retry/restart routes | Retry only failed/stale work; do not create duplicate applications. |
| Application queue | `src/app/application-queue/page.tsx` and `applicationsRepository.ts` | Human AE review surface. `in_ai_pipeline` means AI work is pending; `ready_for_review` means AE review is needed. |
| Finalization | `src/lib/ai/application-agents/finalizationService.ts` | Saves the final AI resume draft and advances `in_ai_pipeline` to `ready_for_review` without submitting externally. |
| Scheduled dispatcher | `.github/workflows/scheduled-jobs.yml` | Existing workflow dispatcher runs every five minutes and loops approximately 4.5 minutes with 15-second polling. |

The scheduled matcher itself is not the same thing as the workflow dispatcher. The matcher creates/starts work; the dispatcher drains the AI workflow queue.

## 3. Live schemas and relationships

The following are the important live tables. Use the database's actual column definitions as the final authority if a migration adds a field.

### 3.1 Candidate and resume source tables

`candidates`

- `id uuid primary key`
- `name`, `email`, `status`
- `verified_skills` — recruiter-confirmed skills; useful evidence, not a reason to invent experience
- `notes` — internal context; never copy directly into resume output

`base_resumes`

- `id uuid primary key`
- `candidate_id uuid -> candidates.id`
- `name`, `status`, `target_industry`, `target_roles`
- `content jsonb` — normalized resume document containing header, summary, skills, experience, education, certifications, and formatting
- `updated_at`

Use `lower(candidates.status) = 'active'`. A candidate being present in the database is not enough. Do not process inactive, rejected, archived, or deleted candidates.

Recommended source filter: `base_resumes.status = 'approved'`. If the product intentionally permits another human-approved status, make that status explicit in configuration; never silently use an unapproved draft.

`candidate_resume_search_profiles`

- `candidate_id uuid`
- `base_resume_id uuid` with one profile per base resume
- `keywords text[]`
- `keyword_states jsonb` — each state has `term`, `status` (`active`/`dismissed`), category, evidence, reason, source (`ai`/`manual`), and audit fields
- `additional_rules text`
- `generation_status` (`running`, `complete`, `failed`, or manual/empty state)
- `last_generation_error`
- `last_generated_at`
- `last_generation_model`
- `last_generation_prompt_version`
- `updated_by`, `updated_at`

AI reruns must keep dismissed terms dismissed. Managers/admins can cross out individual terms, restore them, add terms, and edit rules. A scheduled worker must not overwrite those human decisions.

### 3.2 Job discovery table

`jobs`

- `id uuid primary key`
- `job_number integer` — human-facing identifier used in the queue
- `title`, `company`, `location`
- `source`, `source_url`, `apply_url`, `external_job_id`, `ref_id`
- `is_active boolean`
- `role_tier`, `seniority_level`, `employment_type`
- `work_authorization`, `work_authorization_evidence`
- `posted_at`, `created_at`, `last_seen_at`
- `description_text`, `raw_description`, `description_html`
- `parsed_description jsonb`
- `category_tags text[]`, `job_category`, `ai_suggested_category`
- `category_relevance_score`, `ai_confidence_score`

Minimum job eligibility for matching:

```sql
WHERE jobs.is_active = true
  AND COALESCE(jobs.description_text, jobs.raw_description, jobs.description_html, '') <> ''
```

Do not trust a title alone. A job with a generic title and an unrelated description is not a match. A job description containing `job has expired`, `position closed`, or equivalent stale language should be rejected or sent to an AE review bucket.

### 3.3 Application and AE hand-off tables

`applications`

Important columns:

- `id uuid primary key`
- `candidate_id uuid -> candidates.id`
- `job_id uuid -> jobs.id`
- `status` — operational status; a newly logged ticket normally uses `assigned`
- `source_type` — use `base_resume` for this workflow
- `base_resume_id uuid -> base_resumes.id`
- `assigned_by`, `assigned_to`, `assigned_by_user_id`, `assigned_to_user_id`
- `assignment_note`, `next_action`, `notes`, `priority`, `review_status`
- `ae_stage` — use `in_ai_pipeline` on creation
- `ae_stage_updated_at`, `ae_stage_updated_by_user_id`, `ae_stage_updated_by_name`
- `ai_workflow_id uuid -> application_ai_workflows.id`
- `tailored_resume_version_id uuid -> application_resume_versions.id`
- `resume_generation_status` (`queued`, `running`, `ready`, `failed`)
- `resume_generation_started_at`, `resume_generation_completed_at`, `resume_generation_error`
- `applied_at`, `proof_url`, `submission_url` — must remain untouched by the scheduled worker
- `created_at`, `updated_at`, `created_by`

The valid AE stages are:

```text
in_ai_pipeline -> ready_for_review -> ready_for_application -> applied
```

The scheduled worker may create `in_ai_pipeline`. It must not automatically move a ticket to `ready_for_application` or `applied`.

`application_events`

- `id`
- `application_id`
- `from_status`
- `to_status`
- `note`
- `created_at`

Create an event when the ticket is created, for example `NULL -> assigned`. Do not assume a `created_by` column exists in every deployed schema.

### 3.4 Matching and workflow context tables

`target_jobs`

- `id uuid primary key`
- `candidate_id uuid`
- `job_id uuid`
- `raw_description text`
- `parsed_description jsonb`
- `fit_score numeric`
- `recommendation text`
- `created_by uuid`
- `created_at`

Use the candidate/job pair as the idempotency boundary. Upsert rather than create duplicate target-job rows.

`application_resume_versions`

- `id uuid primary key`
- `candidate_id uuid`
- `base_resume_id uuid`
- `target_job_id uuid -> target_jobs.id`
- `application_id uuid` — present in the live schema and used by the application pipeline
- `job_id uuid` — present in the live schema and used for exact application linkage
- `workflow_id uuid` — populated for AI-generated versions
- `content jsonb`, `formatting jsonb`
- `status` (`draft`, `in_review`, `approved`, `archived`)
- `source_type` (`base_resume`, `ai_agent`, `manual`, etc.)
- `title`, `version_label`, `generated_text`
- `source_resume_id`, `created_by`, `created_at`, `updated_at`
- `ats_score`, `truth_score`, `one_page_fit_score`

The initial copied base-resume version should be the source context for tailoring. The final AI output is a separate `source_type = 'ai_agent'` draft version created during finalization.

`application_packets`

This is one-to-one with `applications`; `application_id` is the primary/unique key and there is no separate packet ID to assume.

- `application_id`
- `resume_version_id`
- `final_resume_version_id`
- `base_resume_id`
- `target_job_id`
- `packet_status`
- `cover_letter`, `recruiter_message`, `hiring_manager_email`, `interview_prep_notes`
- `approved_keyword_ids`, `rejected_keyword_ids`
- `created_by`, `created_at`, `updated_at`

Create or upsert the packet after the base-resume version exists. Finalization later updates `final_resume_version_id`.

`application_ai_workflows`

- `id uuid primary key`
- `application_id uuid -> applications.id`
- `base_resume_id uuid -> base_resumes.id` — this is the direct `base_resumes.id`, not an `application_resume_versions.id`
- `status`: `queued`, `running`, `waiting`, `failed`, `cancelled`, `completed`
- `current_stage integer`
- `idempotency_key`
- `config_snapshot jsonb` — immutable candidate/job/resume/evidence snapshot
- `started_by`, `started_at`, `completed_at`, `cancelled_at`
- `last_error`
- `claimed_at`, `claim_expires_at`, `claimed_by`, `heartbeat_at`
- `lock_version`, `recovery_count`, `updated_at`
- `match_score`, `match_reason`

The current default concurrency cap is `MAX_CONCURRENT_AI_WORKFLOWS = 8`. Other selected workflows remain queued and are drained automatically.

`application_ai_stage_runs`

- `workflow_id`
- `automation_id`
- `sequence_number`, `attempt_number`
- `status`: `pending`, `running`, `success`, `failed`, `skipped`, `cancelled`
- provider/model/key/prompt metadata
- input/output artifact IDs
- token, cost, latency, error, start, and completion metadata

`application_ai_artifacts`

- `workflow_id`
- `automation_id`
- `sequence_number`
- `schema_version`
- `content_hash`
- `data jsonb`
- `created_at`

Artifacts are immutable evidence of each AI stage. Do not overwrite them to hide a bad result.

## 4. How to read a candidate correctly

For each active candidate, create an in-memory candidate packet containing:

```json
{
  "candidate": {
    "id": "candidates.id",
    "name": "candidates.name",
    "email": "candidates.email",
    "verifiedSkills": "candidates.verified_skills",
    "notes": "internal only"
  },
  "baseResume": {
    "id": "base_resumes.id",
    "name": "base_resumes.name",
    "targetIndustry": "base_resumes.target_industry",
    "targetRoles": "base_resumes.target_roles",
    "content": "base_resumes.content"
  },
  "searchProfile": {
    "keywords": "candidate_resume_search_profiles.keywords",
    "keywordStates": "candidate_resume_search_profiles.keyword_states",
    "additionalRules": "candidate_resume_search_profiles.additional_rules"
  },
  "evidence": "candidate_evidence, newest useful entries first",
  "sourceOfTruth": "candidate_source_of_truth plus confirmed skills",
  "job": "one normalized jobs row"
}
```

Rules for interpreting the packet:

- A detailed domain-specific base resume outranks a generic candidate summary.
- A keyword is a discovery signal, not permission to claim experience.
- `verified_skills` can confirm a skill but cannot create years of experience, a job title, a license, or an achievement.
- `candidate.notes` and internal source-of-truth notes may guide matching, but never appear in generated resume content or external messages.
- The selected base resume must be the one whose demonstrated work best fits the job. Do not use the newest resume by default.
- Preserve exact tools and technologies when they appear in the source resume. Do not merge materially different technologies into a generic term.
- Never infer sponsorship, citizenship, relocation, remote eligibility, salary acceptance, or commute willingness unless explicitly recorded.

## 5. Matching and interview-likelihood policy

Score each `(candidate, base_resume, job)` pair from 0 to 100. The score is a ranking tool, not an automated promise.

Suggested scoring model:

| Component | Points | What counts |
|---|---:|---|
| Direct title/domain match | 0–30 | The title is a role the resume can credibly support. Exact domain titles outrank generic titles. |
| Demonstrated technical match | 0–25 | Required/preferred tools, protocols, platforms, and methods are present in the resume/evidence. |
| Responsibility match | 0–20 | The candidate has performed materially similar work, not just used a related keyword. |
| Seniority/experience fit | 0–10 | The level and required years fit the demonstrated scope. |
| Eligibility/location quality | 0–10 | No known work-authorization, clearance, location, or employment mismatch. |
| Job quality/freshness | 0–5 | Active, current, complete, canonical posting with a usable application path. |

Suggested penalties:

- `-25` or hard reject for an explicit mandatory license/certification the candidate does not have.
- `-25` or hard reject for an explicit mandatory citizenship/clearance requirement not supported by candidate records.
- `-20` for a clearly senior/staff/principal/manager/director role when the resume demonstrates only junior/associate scope.
- `-15` for a mandatory years requirement materially above the candidate's demonstrated experience.
- `-15` for a different primary domain with only a generic keyword overlap.
- `-10` for a role that is primarily sales, recruiting, commission-only, or unrelated field service when the base resume is design/engineering focused.
- `-10` for incomplete, stale, or low-confidence job data; reject if the posting is clearly closed.

### 5.1 Freshness is a hard gate

For the active-candidate application workflow, freshness is not merely a ranking preference:

- `posted_at >= run_started_at - 7 days` is required for automatic selection.
- Posted 0–3 days ago: highest freshness priority.
- Posted 4–7 days ago: eligible, but ranked below newer postings when fit is otherwise comparable.
- Posted more than 7 days ago: reject automatically for this workflow, even if the job is still marked active.
- A job “refreshed,” “crawled,” or “seen” recently is not a newly posted job. Do not use `last_seen_at` or `created_at` as a substitute for `posted_at`.
- A source-relative date such as “3 days ago” must be converted to an absolute UTC timestamp at ingestion. If the conversion is unavailable, do not auto-log the job.
- A repost with a new external requisition ID may be eligible if its new `posted_at` is within 7 days; a syndicated copy of an old requisition is not.
- Store `freshness_days`, `freshness_source`, and `freshness_decision` in the match decision audit record so an AE can see why the job was accepted or rejected.

Recommended SQL pre-filter:

```sql
WHERE j.is_active = true
  AND j.posted_at IS NOT NULL
  AND j.posted_at >= ($runStartedAt AT TIME ZONE 'UTC') - INTERVAL '7 days'
  AND j.posted_at <= ($runStartedAt AT TIME ZONE 'UTC') + INTERVAL '1 day'
  AND COALESCE(j.description_text, j.raw_description, j.description_html, '') <> ''
```

The one-day future tolerance is only for source clock skew. Any job outside that tolerance must be rejected or reviewed rather than silently accepted.

Selection gates:

- Tier A: score `85–100`, direct match, no hard exclusion. Select first.
- Tier B: score `70–84`, defensible adjacent match, no hard exclusion. Use only when it remains credible and needed to reach the target.
- Below `70`: do not log automatically.
- If fewer than 20 jobs pass, log fewer and report the shortage. Never pad the list with weak matches.
- Maximum 50 new applications per candidate per run.
- Avoid duplicate company/title/location postings unless they are clearly different requisitions with different application URLs or job IDs.

Candidate-specific rules come from `additional_rules` and human review. They are constraints, not prose suggestions. Examples:

- “Reject roles requiring more than 5 years” is a hard filter when the job explicitly requires more than 5 years.
- “Prefer Metro Detroit; remain open to remote” is a ranking preference, not a rejection rule.
- “Do not select security roles” excludes security-focused work even if a generic network keyword matches.

## 6. Safe creation sequence

For each selected job, perform these steps in order:

1. Re-check `candidates.status = 'active'` and `jobs.is_active = true` immediately before writing.
2. Re-check `SELECT id FROM applications WHERE candidate_id = $candidateId AND job_id = $jobId`. If any row exists, skip it. Do not duplicate, overwrite, reassign, or restart it automatically.
3. Create the application using the application repository/service with:

   - `status = 'assigned'`
   - `source_type = 'base_resume'`
   - exact `base_resume_id`
   - configured AE assignment (`assigned_to_user_id`)
   - `ae_stage = 'in_ai_pipeline'`
   - `resume_generation_status = 'queued'`
   - `next_action = 'Review tailored resume and apply if approved'`
   - a concise internal match reason

4. Record an `application_events` row for the assignment.
5. Upsert `target_jobs` for `(candidate_id, job_id)` with raw description, parsed description if available, fit score, and recommendation.
6. Call `triggerAiWorkflowForApplication(applicationId, actorUserId, preferredBaseResumeId)`.
7. Confirm the returned workflow is attached to the application and has `status = 'queued'` or `status = 'running'`.
8. If the service returns “active workflow already exists,” treat it as idempotent success only if the existing workflow belongs to the same application and selected base resume. Otherwise stop and alert.

Do not manually set `application_ai_workflows.base_resume_id` to a resume-version ID. The foreign key is to `base_resumes.id`.

Do not set `applications.resume_id` to a `base_resumes.id`; that legacy field points to the separate `resumes` table. Use `applications.base_resume_id` and the workflow service for base-resume selection.

## 7. Workflow stages that must run

The existing application AI workflow executes these four stages in order:

1. `application_job_lens` — analyze the JD and extract requirements.
2. `application_resume_forge` — produce an evidence-supported tailored resume draft.
3. `application_hiring_panel` — grade the draft as recruiter, HR manager, and ATS.
4. `application_final_polish` — apply approved feedback and run final QA.

The finalization service persists a new `application_resume_versions` row with `source_type = 'ai_agent'`, links it to the application/workflow/job/base resume, updates the packet's `final_resume_version_id`, marks the workflow `completed`, and advances the AE stage from `in_ai_pipeline` to `ready_for_review` only if a human has not already moved it.

The workflow agent IDs are configured in `src/lib/ai/application-agents/types.ts` and runtime settings are read from `ai_agent_configs`. Do not hard-code an AI provider or API key in the matcher. Read the model/provider/prompt version from the AI Control Center configuration. Any new matcher agent must be registered there before scheduling it.

## 8. Schedule and queue design

Recommended production schedule:

- Run job ingestion first.
- Run job categorization/description enrichment.
- Run the active-candidate matcher once daily after the ingestion window, or on demand after a major ingestion.
- Run the existing workflow dispatcher every five minutes; it already loops with approximately 15-second polling during the scheduled window.
- Do not launch one AI request per job in the matcher. Use deterministic pre-scoring and only send borderline candidates to an AI judge if necessary.

Recommended route:

```text
POST /api/cron/active-candidate-job-match
Authorization: Bearer $CRON_SECRET
```

Recommended implementation symbol:

```text
runActiveCandidateJobMatchBatch({
  actorUserId,
  assignedToUserId,
  minNewPerCandidate: 20,
  maxNewPerCandidate: 50,
  lookbackDays: 7,
  dryRun,
})
```

Use a run-level lock so two scheduler invocations cannot select the same jobs simultaneously. The preferred additions are:

`candidate_job_match_runs`

- `id`, `started_at`, `completed_at`, `status`, `actor_user_id`
- `candidate_count`, `created_count`, `skipped_count`, `failed_count`
- `config_snapshot`, `summary`, `last_error`

`candidate_job_match_decisions`

- `run_id`, `candidate_id`, `base_resume_id`, `job_id`
- `score`, `decision` (`selected`, `rejected`, `duplicate`, `below_threshold`, `hard_exclusion`)
- `reason`, `matched_terms`, `penalties`, `created_application_id`

These audit tables are recommended additions; they are not substitutes for the existing application/workflow tables. They make scheduled behavior explainable and let managers see why a role was skipped.

## 9. Idempotency and failure handling

Use all of these guards:

- Candidate/job application uniqueness check before insert.
- Deterministic workflow idempotency key, such as `active-match:{candidateId}:{jobId}:{baseResumeId}:{runPolicyVersion}`. If the same role was already selected with a different run ID, do not create another workflow.
- Existing active workflow check through `findActiveWorkflowByApplicationId`.
- Upsert `target_jobs` by `(candidate_id, job_id)`.
- Upsert `application_packets` by `application_id`.
- Keep human-dismissed keywords and manual rules during keyword regeneration.
- Use `FOR UPDATE SKIP LOCKED` or an equivalent run lock for queued-work claims.
- Retry failed stages through the existing workflow retry/restart path, not by creating a new application.
- A running workflow with an expired claim may be recovered by the existing two-minute lease logic. After three recoveries it becomes failed and needs review.
- Never silently convert a failed AI workflow into a ready-for-application ticket.

Failure outcomes:

- Missing candidate/base resume: skip and report.
- Inactive candidate/job during the final re-check: skip.
- Existing application: skip as duplicate.
- No quality matches: report a shortage; do not pad.
- Workflow creation failure: keep the application visible with `resume_generation_status = 'failed'`, record the error, and retry through the workflow recovery path.
- Partial writes: use a transaction where possible. If the current service boundary cannot be transactional across application creation and workflow start, run a repair pass that finds applications with `in_ai_pipeline` but no workflow and either starts the workflow or marks the row with a visible error.

## 10. Verification queries

After each candidate batch, verify every selected application with a query equivalent to:

```sql
SELECT
  j.job_number,
  c.name AS candidate,
  a.id AS application_id,
  a.base_resume_id,
  a.ae_stage,
  a.assigned_to_user_id,
  a.ai_workflow_id,
  a.tailored_resume_version_id,
  a.resume_generation_status,
  w.status AS workflow_status,
  w.base_resume_id AS workflow_base_resume_id,
  p.resume_version_id AS packet_resume_version_id,
  p.packet_status,
  COUNT(DISTINCT e.id) AS event_count
FROM applications a
JOIN candidates c ON c.id = a.candidate_id
JOIN jobs j ON j.id = a.job_id
LEFT JOIN application_ai_workflows w ON w.id = a.ai_workflow_id
LEFT JOIN application_packets p ON p.application_id = a.id
LEFT JOIN application_events e ON e.application_id = a.id
WHERE a.candidate_id = $candidate_id
  AND j.job_number = ANY($selected_job_numbers::int[])
GROUP BY
  j.job_number,c.name,a.id,a.base_resume_id,a.ae_stage,a.assigned_to_user_id,
  a.ai_workflow_id,a.tailored_resume_version_id,a.resume_generation_status,
  w.status,w.base_resume_id,p.resume_version_id,p.packet_status;
```

Every selected row must satisfy:

- `ae_stage = 'in_ai_pipeline'` at creation time
- `assigned_to_user_id` equals the configured AE
- `a.base_resume_id` equals the selected base resume
- `a.ai_workflow_id IS NOT NULL`
- `w.base_resume_id = a.base_resume_id`
- workflow status is `queued` or `running` immediately after creation
- packet exists with `packet_status = 'draft'`
- packet/resume version belongs to the same application and job
- `event_count >= 1`
- `applied_at IS NULL` and no external proof/submission was written

Run-level counts should include:

```sql
SELECT
  COUNT(*) AS applications,
  COUNT(*) FILTER (WHERE ae_stage = 'in_ai_pipeline') AS in_ai_pipeline,
  COUNT(*) FILTER (WHERE ai_workflow_id IS NOT NULL) AS with_workflow,
  COUNT(*) FILTER (WHERE resume_generation_status = 'queued') AS queued_generation
FROM applications
WHERE candidate_id = $candidate_id
  AND created_at >= $run_started_at;
```

## 11. Candidate-specific quality examples

The matcher must generalize from the resume, not from the candidate's name. Examples of correct behavior:

- A Solar PV base resume should favor solar/PV design, AutoCAD, PVsyst/HelioScope, system sizing, module stringing, inverter selection, electrical calculations, permit/interconnection packages, AHJ/utility coordination, BESS/PV design, construction drawings, and QA/QC roles. It should not fill the quota with generic field-service, sales, roofing-only, or unrelated electrical roles.
- An FPGA/VLSI base resume should favor FPGA, RTL, Verilog/VHDL, Vivado/Vitis HLS, digital design, SoC, hardware validation, board bring-up, embedded C, ASIC/IC design, Cadence Virtuoso, CMOS, and design-verification roles. It should reject staff/principal roles, hard-clearance roles, and jobs demanding substantially more experience when the resume cannot support them.
- Avirup's GIS base resume should favor GIS Analyst/Technician/Specialist, geospatial data, ArcGIS Pro/Online/Enterprise, ArcPy, QGIS, Field Maps, Survey123, geodatabases, spatial analysis, utility/municipal/infrastructure mapping, field verification, data conversion, topology/geometry QA/QC, and mapping production. Reject pure data-science, remote-sensing research, generic software-engineering, and senior/lead/manager/director roles or explicit requirements above five years unless the posting clearly accepts early-career candidates.
- Avirup's OSP base resume should favor OSP/Outside Plant, fiber/FTTH/FTTx design, route planning, HLD/LLD, permitting, ROW, make-ready, joint use, pole attachment, GIS fiber design, construction-ready documentation, as-builts, field verification, and fiber QA/QC. Reject installer/splicer-only, sales, construction-management, and PE-mandatory roles when the resume cannot support those requirements.
- Avirup's CAD base resume should favor AutoCAD, Civil 3D, utility/telecom/civil/infrastructure drafting, plan production, permit sets, as-builts, redlines, drawing QA/QC, quantity takeoffs, GIS/CAD, and junior/technician/drafter/designer titles. Treat Revit, SolidWorks, MicroStation, Bluebeam, and BIM as secondary signals unless the job makes one the primary requirement; do not match on the word “CAD” alone.
- For Avirup, choose the best single base resume for each canonical job. A GIS job should not create duplicate GIS, OSP, and CAD applications; OSP/fiber jobs should use OSP unless the job is explicitly drafting-heavy, in which case CAD may win. All three profiles share the same hard freshness gate: only jobs posted within the last 7 days are eligible for automatic logging.
- A GIS/OSP/CAD base resume should use its own keyword profile and rules. Never reuse Mahi's Solar or FPGA keywords for another candidate.

## 12. Human review boundary

The scheduled system is successful when it gives the AE a clean, explainable, tailored-resume-ready queue. It is not successful when it maximizes the raw number of applications.

Managers and admins must be able to:

- inspect the exact base resume used;
- see the job-match reason and exclusions;
- dismiss or restore search keywords;
- edit additional rules;
- review AI findings and warnings;
- open the tailored resume in Studio;
- move the AE stage manually;
- reject a recommendation before external submission.

Never hide uncertainty. Label missing work authorization, relocation, seniority, or experience evidence for AE review instead of inventing a favorable assumption.

## 13. Acceptance criteria for the implementation

The scheduled matcher is ready only when all of the following are true:

- It processes only `candidates.status = 'active'`.
- It uses every approved base resume as an independent domain profile.
- It can regenerate missing/stale keyword profiles through `BaseResume_TO_JobSearchKeyword` without resurrecting dismissed terms.
- It reads the full job description and filters inactive, stale, duplicate, and obviously unrelated roles.
- It automatically selects only jobs with a trustworthy `posted_at` within the last 7 days; missing or stale posting dates go to review and never pad the batch.
- It prioritizes postings from the last 72 hours over postings 4–7 days old and never treats `last_seen_at` or ingestion time as posting freshness.
- It produces 20–50 new applications per candidate only when enough roles pass the quality gate, with a hard maximum of 50.
- It never creates duplicate candidate/job applications.
- It assigns selected tickets to the configured AE and records an assignment event.
- It uses the exact selected base resume ID all the way through `applications`, `target_jobs`, `application_resume_versions`, `application_packets`, and `application_ai_workflows`.
- It calls the existing `triggerAiWorkflowForApplication` path and does not invent a parallel workflow implementation.
- It starts the existing four-stage AI pipeline and leaves the ticket in `in_ai_pipeline` until finalization.
- It never submits externally or marks a ticket `applied`.
- It has run-level and per-decision audit records.
- It has dry-run mode, retry behavior, failure visibility, and a final integrity query.
- The matcher route is `CRON_SECRET` protected and the dispatcher remains separately scheduled.
- Tests cover inactive candidates, missing resumes, stale profiles, duplicate jobs, duplicate applications, dismissed keywords, seniority exclusions, clearance exclusions, packet/workflow mismatch, dispatcher capacity, and workflow retries.
- Tests cover missing/malformed `posted_at`, 8-day-old jobs, source-relative timestamps, future timestamps, recent reposts, syndicated copies, and the one-base-resume-per-canonical-job rule.

## 14. Immediate implementation recommendation

Build one service and one protected cron route around this contract:

```text
src/server/services/activeCandidateJobMatchService.ts
src/app/api/cron/active-candidate-job-match/route.ts
```

The service should call repository functions for candidate/job/application writes and `triggerAiWorkflowForApplication` for pipeline start. Add the recommended run/decision audit tables in a migration, add a daily GitHub Actions invocation after job ingestion/categorization, and keep the existing five-minute workflow dispatcher unchanged.

The first production rollout should run in `dryRun = true`, compare decisions with AE review for one day, then enable writes for one candidate cohort. The scheduler should emit a report before and after activation, and any role rejected by a human should become a reusable negative-match rule without contaminating the candidate's personal data.
