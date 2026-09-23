# TalentOS Handover: BaseResume_TO_JobSearchKeyword and Job Ingestion Baseline

## Executive summary

TalentOS previously depended on manually authored keyword lists for each candidate/base resume. Those lists became inconsistent, overly broad, difficult to review, and difficult for the future job-ingestion pipeline to consume reliably. Avirup and Bhaskar exposed the problem clearly: a resume can support several distinct search directions, but a single unstructured keyword textarea does not explain which terms are strong evidence, which terms are adjacent opportunities, or which roles must be rejected.

The implemented solution is an AI-assisted, human-controlled search contract for every base resume:

1. `BaseResume_TO_JobSearchKeyword` reads one active candidate’s base resume and produces a focused list of 20–48 search terms plus ingestion rules.
2. The agent is routed through the AI Control Center to Gemini 2.5 Pro.
3. Managers/admins can add, dismiss, restore, and review each keyword individually.
4. Dismissed keywords persist and cannot silently return on a later AI regeneration.
5. Rules remain editable and are stored with the resume profile.
6. New base resumes and materially updated base resumes automatically trigger generation.
7. A batch action can regenerate profiles for all active candidates with base resumes.
8. Every run is auditable with model, prompt version, input snapshot, output snapshot, status, and error data.

The immediate product objective is better job coverage and fewer false-positive jobs. The longer-term objective is to make adding a new candidate domain a repeatable workflow: upload/approve a base resume, generate a focused search contract, review it once, then let ingestion use the approved contract to discover and stage jobs.

## Problem solved

### Before

- Search terms were manually seeded in SQL or typed into one large textarea.
- Lists grew to 100+ terms and became difficult to reason about.
- Duplicate aliases and generic terms diluted job-search precision.
- There was no structured distinction between:
  - a title the candidate can directly target;
  - a tool or domain directly supported by the resume;
  - a transferable title worth exploring;
  - an adjacent title that needs stricter filtering.
- Managers could not cross out one keyword while preserving the reason it was dismissed.
- There was no run history showing which AI model/prompt produced a profile.
- Creating a new base resume did not automatically produce a job-search baseline.
- The future ingestion pipeline had no stable contract for candidate-specific exclusions such as experience limits, licensing requirements, or domain boundaries.

### After

Each base resume has a separate search profile with:

- active search keywords;
- dismissed keyword history;
- editable additional rules;
- generation status;
- last model used;
- last prompt version;
- generation timestamp/error state;
- auditable AI run records.

This separates the resume itself from the job-search strategy derived from it. The resume remains the factual source of truth. The search profile becomes the reviewed baseline that ingestion can consume.

## Implemented components

### Agent identity and routing

Agent ID and display name:

```text
BaseResume_TO_JobSearchKeyword
```

AI Control Center configuration:

- Automation catalog: `ai_automations`
- Agent configuration: `ai_agent_configs`
- Routing: `ai_automation_routes`
- Primary model: `gemini-2.5-pro`
- Provider route: `google_vertex_proxy`
- Approval policy: `always_human`
- Prompt version currently installed: `v1.1`
- Output schema: `BaseResumeJobSearchKeywordV1`

The agent uses the existing `callWithUsageTracking()` routing layer. This means provider/model selection, usage logging, fallback behavior, and AI Control Center settings remain centralized instead of creating a separate Gemini integration.

Relevant code:

- [baseResumeJobSearchKeywordService.ts](/C:/Users/sakis/Documents/Codex/2026-08-07/wha/work/TalentOS/src/server/services/baseResumeJobSearchKeywordService.ts)
- [AI routing](/C:/Users/sakis/Documents/Codex/2026-08-07/wha/work/TalentOS/src/lib/ai/routing.ts)
- [AI provider abstraction](/C:/Users/sakis/Documents/Codex/2026-08-07/wha/work/TalentOS/src/lib/ai/provider.ts)

### Agent output contract

The model is instructed to return JSON in this form:

```json
{
  "keywords": [
    {
      "term": "OSP Design Engineer",
      "category": "title",
      "evidence": "direct",
      "reason": "Supported by current OSP design experience"
    }
  ],
  "additional_rules": [
    "Prefer early-career roles and reject postings requiring more than 5 years unless they clearly accept junior candidates."
  ]
}
```

Allowed keyword categories:

- `title`
- `skill`
- `tool`
- `domain`
- `work_product`

Allowed evidence labels:

- `direct`
- `transferable`
- `adjacent`

The server normalizes the response, removes duplicates, trims unsafe/control characters, caps active terms at 48, and rejects unusably small outputs.

### Prompt design

Prompt `v1.1` was refined after reviewing the earlier manually authored Avirup/Bhaskar profiles. The main improvements were:

- no generic filler terms;
- no employer names, dates, contact details, or duplicate abbreviations;
- fewer terms are acceptable when additional terms would be padding;
- adjacent titles must be defensible from the degree, experience, or transferable deliverables;
- adjacent terms must be bounded by explicit rules;
- the model must balance titles, tools, domains, and work products without forcing unsupported categories;
- rules must cover experience level, licenses/certifications, location/relocation, strong-fit requirements, and false positives when relevant;
- the output must be JSON only.

The prompt is stored in `ai_agent_configs.system_prompt`, so admins can tune it from the AI Control Center without changing code. The code also contains a fallback prompt for environments where the configuration row is unavailable.

### Database changes

Migration `063_base_resume_job_search_keyword_agent.sql` added:

```text
candidate_resume_search_profiles.keyword_states
candidate_resume_search_profiles.generation_status
candidate_resume_search_profiles.last_generated_at
candidate_resume_search_profiles.last_generation_model
candidate_resume_search_profiles.last_generation_prompt_version
candidate_resume_search_profiles.last_generation_error
```

`keyword_states` is JSONB and stores per-term review state. Example:

```json
[
  {
    "term": "AutoCAD",
    "status": "active",
    "category": "tool",
    "evidence": "direct",
    "reason": "Appears in professional experience",
    "source": "ai"
  },
  {
    "term": "PLC Programmer",
    "status": "dismissed",
    "source": "manual",
    "updated_by": "manager-user-id",
    "updated_at": "2026-08-08T00:00:00.000Z"
  }
]
```

The new audit table is:

```text
base_resume_keyword_agent_runs
```

It stores:

- candidate and base resume IDs;
- trigger type (`new_base_resume`, `resume_updated`, `manual`, or `batch`);
- started/completed/failed status;
- provider/model;
- prompt version;
- sanitized professional input snapshot;
- normalized output snapshot;
- error message;
- creating user and timestamps.

Migration `064_refine_base_resume_keyword_agent_prompt.sql` installed prompt `v1.1`.

### Automatic triggers

New base resume creation:

- `POST /api/base-resumes`
- inserts the resume first;
- runs the agent afterward;
- if AI generation fails, the resume remains saved and the failure is recorded in the search profile/run table.

Base resume update:

- `PATCH /api/base-resumes/[id]`
- changes to `content`, `target_industry`, or `target_roles` trigger regeneration;
- name-only changes do not trigger regeneration.

This is intentionally failure-tolerant. A Gemini outage must not destroy or roll back a user’s base resume.

### Manual and batch endpoints

Single base resume:

```http
POST /api/admin/base-resume-keywords/run
Content-Type: application/json

{"baseResumeId":"BASE_RESUME_UUID"}
```

All active base resumes:

```http
POST /api/admin/base-resume-keywords/run
Content-Type: application/json

{}
```

Only `admin` and `manager` roles can invoke these actions. The batch endpoint processes active candidates only and reports a per-resume success/failure result instead of aborting the entire batch on one failure.

### Review UI

On the candidate’s Job search profiles page, each base-resume card now supports:

- Generate keywords with AI;
- Save review;
- active keyword chips;
- dismiss/cross out one keyword;
- restore a dismissed keyword;
- add a keyword manually;
- edit additional rules;
- display active count against the 48-term ceiling;
- display generation status, model, and prompt version.

The candidate-wide generate button was removed from this page because generation is fundamentally scoped to one base resume.

The all-active batch button belongs in:

```text
AI Control Center → Agents & Routing → Run keyword agent for all active resumes
```

The page-level button is the normal review workflow. The AI Control Center button is the operational backfill/reprocessing workflow.

Relevant UI/API files:

- [job-search-profiles page](/C:/Users/sakis/Documents/Codex/2026-08-07/wha/work/TalentOS/src/app/candidates/[id]/job-search-profiles/page.tsx)
- [job-search-profiles API](/C:/Users/sakis/Documents/Codex/2026-08-07/wha/work/TalentOS/src/app/api/candidates/[id]/job-search-profiles/route.ts)
- [batch/single-run API](/C:/Users/sakis/Documents/Codex/2026-08-07/wha/work/TalentOS/src/app/api/admin/base-resume-keywords/run/route.ts)
- [AI Control Center](/C:/Users/sakis/Documents/Codex/2026-08-07/wha/work/TalentOS/src/app/admin/ai/page.tsx)

## Current data state

At the last database verification:

- 16 active base resumes existed across active candidates.
- Bhaskar’s manually seeded 131/138-term profiles were cleared intentionally.
- Bhaskar’s three base resumes are ready for agent generation:
  - existing OSP resume;
  - new CAD resume;
  - new Mechanical Engineering resume.
- Avirup’s previous manual profiles still exist as `manual` profiles until the batch agent is run.
- The agent configuration is present with prompt `v1.1` and Gemini `gemini-2.5-pro` routes.
- The live AI usage count was still zero during development verification because no authenticated TalentOS session was available to execute the batch.

The first operational step after deployment is therefore:

1. Sign in as an admin or manager.
2. Open AI Control Center → Agents & Routing.
3. Confirm `BaseResume_TO_JobSearchKeyword` is ready and routed to Gemini 2.5 Pro.
4. Click “Run keyword agent for all active resumes.”
5. Review failures, then open Bhaskar and Avirup’s profiles for human review.

## What the job-ingestion developer must implement next

The current feature creates and reviews the search contract. It does not yet drive job ingestion. The ingestion pipeline should treat the approved profile as an input contract, not as an untrusted blob of text.

### Recommended ingestion flow

```text
Active candidate
  → approved base resume
    → reviewed search profile
      → keyword/query planner
        → source-specific job fetchers
          → normalization/deduplication
            → AI relevance classification
              → candidate/job fit score
                → staged job review queue
                  → AE decision
```

### Step 1: select eligible profiles

Only ingest profiles where:

- the candidate is active;
- the base resume is approved or explicitly allowed by product policy;
- the search profile exists;
- `generation_status` is `complete` or the profile was manually saved;
- there is at least one active keyword;
- the profile is not currently disabled by a manager.

Do not ingest dismissed keywords. They are review history, not search inputs.

The recommended query shape is:

```sql
SELECT
  c.id AS candidate_id,
  c.name AS candidate_name,
  br.id AS base_resume_id,
  br.name AS base_resume_name,
  br.target_industry,
  br.target_roles,
  p.keywords,
  p.keyword_states,
  p.additional_rules,
  p.generation_status
FROM candidates c
JOIN base_resumes br ON br.candidate_id = c.id
JOIN candidate_resume_search_profiles p ON p.base_resume_id = br.id
WHERE lower(c.status) = 'active'
  AND br.status = 'approved'
  AND p.generation_status IN ('complete', 'manual')
  AND cardinality(p.keywords) > 0;
```

Adjust the resume-status requirement only if the business wants draft resumes to drive ingestion.

### Step 2: build query batches

Do not send all 48 keywords as one literal query to every source. Build smaller source-specific query batches:

- title batches: 3–8 related titles;
- tool/domain batches: 2–5 meaningful terms;
- location batches: candidate preference/relocation policy;
- source filters: remote/hybrid/on-site, employment type, salary, authorization, and geography.

Examples for an OSP/CAD resume:

```text
OSP Design Engineer + AutoCAD
Fiber Design Engineer + FTTH
OSP CAD Designer + HLD/LLD
Utility CAD Technician + permit drawings
```

Examples for a Mechanical Engineering resume:

```text
Entry-Level Mechanical Engineer + AutoCAD
Project Engineer + BOM + technical documentation
Mechanical Design Engineer + CAD
Manufacturing Engineer + engineering documentation
```

The query planner should use the keyword category/evidence fields when available. Strong/direct titles should be searched first. Transferable/adjacent terms should be searched as a second pass and scored more conservatively.

### Step 3: apply rules before expensive AI scoring

`additional_rules` should become deterministic filters wherever possible. Examples:

- maximum years of experience;
- reject senior/lead/principal/manager roles;
- reject roles requiring PE or another unavailable license;
- reject roles whose primary requirement is unsupported software;
- reject roles whose primary function is PLC/SCADA/robotics when the candidate only has adjacent mechanical/project evidence;
- enforce candidate location/relocation preferences;
- enforce authorization/work-mode/employment-type constraints.

The pipeline should preserve both:

```text
rule_decision: pass | reject | review
rule_reasons: string[]
```

Do not hide a rejection. AEs need to know why a job did not enter the queue.

### Step 4: normalize and deduplicate jobs

The same job will appear across LinkedIn, Indeed, company career sites, Greenhouse, Lever, Workday, Ashby, Zoho, USAJobs, and aggregators. Deduplicate using a layered key:

1. canonical application URL;
2. ATS job ID plus source/company;
3. normalized company + normalized title + location;
4. fuzzy title/location fallback when the source does not provide a stable ID.

Keep source evidence in a child/source table or JSON structure. Do not throw away the fact that a job appeared on multiple sources.

Recommended fields:

```text
job_id
source
source_job_id
canonical_url
company_id
title
location
employment_type
work_mode
salary
description
first_seen_at
last_seen_at
```

### Step 5: separate discovery match from application fit

A keyword hit is not a recommendation. Store at least two concepts:

- `discovery_match`: why the job was found;
- `candidate_fit`: whether the job is suitable after reading the posting.

Recommended scoring inputs:

- title match;
- direct skill/tool match;
- domain match;
- work-product match;
- education match;
- experience-level compatibility;
- rule compliance;
- location/work-mode compatibility;
- unsupported-primary-requirement penalty;
- duplicate/application-history penalty.

The AI fit scorer should receive the candidate’s selected base resume and the reviewed search rules, not every base resume indiscriminately.

### Step 6: route results to AE review

Each staged job should say:

- which candidate and base resume found it;
- which keyword(s) found it;
- which rules passed or failed;
- fit score and score explanation;
- whether it is a direct, transferable, or adjacent match;
- whether the candidate has already applied;
- whether an AE has reviewed it;
- whether the job is pending, approved, rejected, or needs clarification.

This is how the system gets more jobs without flooding AEs with irrelevant postings.

## Domain expansion strategy

The system should make a new candidate domain easy to add without adding custom code for every person.

### New candidate onboarding contract

For every new active candidate:

1. Create the candidate profile.
2. Upload and parse the source resume.
3. Create one or more base resumes by domain.
4. Approve the base resume(s).
5. Let `BaseResume_TO_JobSearchKeyword` generate the search contract automatically.
6. Have a manager review/dismiss/add terms and rules.
7. Activate ingestion for that profile.
8. Review the first batch of staged jobs and feed outcomes into later prompt/rule improvements.

### Domain examples

The same architecture should support:

- GIS and geospatial analysis;
- OSP/fiber/telecom infrastructure;
- CAD and drafting;
- mechanical engineering;
- controls/project engineering;
- data center operations;
- FPGA/VLSI;
- solar/PV design;
- civil/infrastructure design;
- network operations/NOC;
- construction/project coordination;
- healthcare, finance, or other future domains.

The agent should not have hardcoded Avirup- or Bhaskar-specific logic. Candidate-specific constraints belong in the resume/profile and reviewed rules. Domain-specific prompt examples can be added later as controlled guidance, but the output contract should stay consistent.

## Human-review rules

Managers/admins are allowed to:

- dismiss a keyword;
- restore a dismissed keyword;
- add a new keyword;
- edit additional rules;
- save a manual review.

When a manager dismisses a term, the server records it as `status = dismissed` instead of deleting it. A later AI run must preserve that dismissal. When a manager adds a keyword, it is stored as a manual active state and is preserved during future AI generation.

Application engineers can view profiles but cannot change them through the review API. This keeps the baseline search contract under manager/admin control.

## Edge cases the ingestion implementation must handle

### No profile yet

Do not run ingestion. Show “keyword profile pending” and provide a manager action to generate it.

### AI generation failed

Do not silently use an empty profile. Show the error and allow retry. The base resume remains usable for resume tailoring.

### Fewer than 20 keywords

Accept a smaller list if the agent says additional terms would be padding. Do not artificially add generic terms to reach a quota.

### More than 48 keywords

The server truncates active terms to 48 after normalization. The prompt also instructs the model never to exceed 48. The ingestion pipeline should enforce the same limit defensively.

### All keywords dismissed

Do not ingest. Show the profile as requiring review and explain that no active search terms remain.

### Manual save after AI generation

Preserve AI metadata for the last generation, but set `generation_status = manual` so the current active list is understood to be manager-edited.

### Resume materially changed

Regenerate automatically, but preserve manager-dismissed terms. The manager should review newly proposed terms before ingestion uses them.

### Candidate becomes inactive

Stop ingestion immediately. Do not generate new profiles for inactive candidates. Existing profiles should remain for audit/history but must not create new jobs.

### Candidate has several base resumes

Treat each base resume as its own search contract. A job can match more than one base resume; deduplicate the job but retain all matching resume/profile references.

### Unsupported adjacent title

The term may remain as a discovery term only if the rules classify it as adjacent/transferable and the fit scorer applies a conservative penalty. Do not present it as direct experience.

### Same keyword in multiple profiles

This is expected. Search terms are resume-specific because the rules and target role context differ. Deduplicate jobs globally, not keywords across candidates.

### Personal/non-professional resume data

The agent receives a sanitized professional snapshot with phone, email, and LinkedIn removed. Ingestion must never use personal email content, unrelated personal data, or private candidate information as job-search keywords.

## Acceptance tests

### Agent configuration

- [ ] `BaseResume_TO_JobSearchKeyword` appears in AI Control Center.
- [ ] Primary route shows Gemini 2.5 Pro.
- [ ] Prompt version shows `v1.1`.
- [ ] Provider usage events record the agent ID and model.

### New resume trigger

- [ ] Create a new base resume for an active candidate.
- [ ] Confirm a profile is created automatically.
- [ ] Confirm generation status becomes `complete` on success.
- [ ] Confirm a provider/model and prompt version are stored.
- [ ] Simulate provider failure and confirm the resume still saves with a failed profile status.

### Human review

- [ ] Dismiss one keyword and save.
- [ ] Confirm it appears in dismissed history.
- [ ] Regenerate with AI.
- [ ] Confirm the dismissed term does not return to active keywords.
- [ ] Restore the term and save.
- [ ] Add a manual keyword and confirm it persists after regeneration.
- [ ] Confirm application engineers can view but cannot save changes.
- [ ] Confirm active keyword count never exceeds 48.

### Batch generation

- [ ] Run “Run keyword agent for all active resumes” from AI Control Center.
- [ ] Confirm all active base resumes are attempted.
- [ ] Confirm one failure does not abort the rest.
- [ ] Confirm inactive candidates are skipped.
- [ ] Confirm Bhaskar’s CAD, Mechanical Engineering, and OSP profiles are regenerated.
- [ ] Confirm Avirup’s prior manual lists are replaced with reviewed agent output after the batch.

### Ingestion integration

- [ ] Ingestion reads only active, approved, reviewed profiles.
- [ ] Dismissed terms are never sent to source queries.
- [ ] Rules are applied before expensive AI scoring where deterministic.
- [ ] Jobs store candidate/base-resume/keyword provenance.
- [ ] Duplicate jobs across sources are merged without losing source evidence.
- [ ] AEs can see why a job was included or excluded.

## Future goals

### Near term: make the baseline operational

- Run and review the first full batch for all 16 active base resumes.
- Review Bhaskar and Avirup output quality first because their profiles expose the most domain breadth.
- Add a profile-level enable/disable control.
- Add a “needs review” status separate from `complete` and `manual`.
- Add run history to the review page so managers can compare generations.
- Add prompt/model cost and latency to the per-profile review view.

### Job ingestion productization

- Build a query planner that groups terms by title/domain/tool category.
- Implement source-specific query adapters and pagination.
- Normalize Greenhouse, Lever, Workday, Ashby, Zoho, LinkedIn, Indeed, USAJobs, and company career pages into one job schema.
- Add source health, rate-limit handling, retries, and crawl checkpoints.
- Add job freshness/expiration handling.
- Add duplicate detection and canonical URL resolution.
- Build a staged-job review queue for AEs.

### Feedback loop

Capture manager/AE decisions:

- good match;
- poor match;
- wrong domain;
- too senior;
- unsupported required tool;
- location mismatch;
- duplicate;
- already applied;
- missing/expired job;
- candidate not interested.

Use those decisions to:

- improve candidate-specific rules;
- identify noisy keywords;
- identify missing title aliases;
- improve source query construction;
- tune fit scoring;
- propose prompt updates for manager approval.

Do not automatically change a reviewed profile from feedback until a manager approves the change.

### Domain intelligence

- Add reusable domain playbooks for GIS, OSP, CAD, mechanical, controls, data center, FPGA/VLSI, solar, civil, and NOC candidates.
- Store domain-specific title taxonomies and aliases separately from candidate-specific terms.
- Let the agent use the playbook as controlled supplemental context while keeping the candidate resume as the evidence source.
- Track which job titles actually produce interviews and offers, not only which terms produce volume.

### Candidate/job matching

- Select the best base resume automatically for each job.
- Generate a tailored resume only after the job passes rule and fit gates.
- Attach the exact search profile used to the application log.
- Let the browser extension open the correct application with the correct candidate/base resume context.
- Feed application outcomes and recruiter responses back into the job and candidate record.

## Version history

Relevant pushed commits on `neon-cloudflare-migration`:

- `8391bac` — added Bhaskar CAD and Mechanical Engineering base resumes.
- `201fbab` — expanded manual Bhaskar OSP/CAD/Mechanical search profiles.
- `04a44d7` — added the automated BaseResume_TO_JobSearchKeyword agent, schema, routes, automatic triggers, and review controls.
- `372ba46` — refined the prompt to `v1.1` and reduced keyword padding/duplicate aliases.
- `6ee2bf4` — exposed a batch run control.
- `0b89627` — moved generation action to each base-resume card and removed the candidate-wide card action.

The branch was clean and pushed after the latest change.

## Developer handoff checklist

1. Pull `neon-cloudflare-migration`.
2. Confirm migrations `059` through `064` are applied in order.
3. Sign in as admin/manager.
4. Verify `BaseResume_TO_JobSearchKeyword` in AI Control Center.
5. Run the all-active batch once.
6. Review Avirup and Bhaskar output manually.
7. Add ingestion query-planning code against `candidate_resume_search_profiles`.
8. Apply deterministic `additional_rules` before AI fit scoring.
9. Preserve keyword/job provenance in the staged-job records.
10. Add ingestion tests for active/inactive candidates, multiple resumes, dismissed terms, duplicate jobs, and adjacent-role penalties.
11. Only then enable recurring ingestion automation.

