# TalentOS active base resumes and high-volume job-matching master prompt

Snapshot: 2026-08-11  
Repository: https://github.com/alsaki27/TalentOS  
Production: https://talent.skarion.com  
Production branch: `neon-cloudflare-migration`

This document is the handover and paste-ready operating contract for a low-cost AI worker that receives a large job corpus, evaluates it against the active TalentOS base-resume profiles, and returns only defensible interview opportunities. It is intentionally conservative: matching is allowed, logging to the internal queue is allowed only when explicitly enabled, and external application submission is never allowed.

The complete deduplicated keyword manifest is stored in [all_job_search_keywords.csv](outputs/keyword_compilation/all_job_search_keywords.csv). It contains 1,147 unique normalized terms from candidate profiles, Apify/job-agent keyword groups, OpenJobs legacy definitions, and shared saved searches. The CSV is the canonical term-level export; this document is the candidate/profile-level operating contract.

## 1. Current active base-resume inventory

The inventory below includes every profile in the live snapshot where the candidate status was `active` and the base resume was not treated as archived. `keyword_count` is the stored keyword count. `active_state_count` is the count remaining after `keyword_states` dismissal filtering; when a profile has no state rows, use the stored `keywords` array as the fallback. `review_status` and `generation_status` are important gates.

| Candidate | Base resume | Keywords | Active states | Review | Generation | Matching readiness |
|---|---|---:|---:|---|---|---|
| Avirup Bhattacharjee | `Resume_Avirup(CAD)` | 73 | 73 | needs_review | complete | Human approval required |
| Avirup Bhattacharjee | `Resume_Avirup(GIS)` | 61 | 61 | needs_review | complete | Human approval required |
| Avirup Bhattacharjee | `Resume_Avirup(OSP)` | 60 | 0* | pending | manual | Generate/review before auto-match |
| Bhaskar Roy | `Resume_Bhaskar(CAD)` | 138 | 0* | pending | manual | Regenerate/review before auto-match |
| Bhaskar Roy | `Resume_Bhaskar(Mechanical Engineering)` | 132 | 0* | pending | manual | Regenerate/review before auto-match |
| Bhaskar Roy | `Resume_Bhaskar_Roy(CAD)` | 37 | 37 | pending | complete | Human approval required |
| Bhaskar Roy | `Resume_Bhaskar_Roy(Mechanical Eng.)` | 41 | 41 | pending | complete | Human approval required |
| Bhaskar Roy | `Resume_Bhaskar_Roy(OSP)-1` | 131 | 0* | pending | manual | Generate/review before auto-match |
| MD MAHBUBUL ALAM | `Resume_Mahbubul_Islam(Data Center Technician)` | 46 | 46 | pending | complete | Human approval required |
| MD MAHBUBUL ALAM | `Resume_Mahbubul_Islam(ISP-NOE)` | 48 | 48 | pending | complete | Human approval required |
| MD MAHBUBUL ALAM | `Resume_Mahbubul_Islam(NOC)` | 41 | 41 | pending | complete | Human approval required |
| Maahir Azmain Chowdhury | `Resume_Maahir(OSP)` | 37 | 37 | pending | complete | Human approval required |
| Maahir Azmain Chowdhury | `Resume_Maahir_Azmain_Chowdhury (CAD Drafter)` | 40 | 40 | pending | complete | Human approval required |
| Maahir Azmain Chowdhury | `Resume_Maahir_Azmain_Chowdhury (GIS)` | 44 | 44 | pending | complete | Human approval required |
| Saddam H. | `Resume_Saddam_H.(CAD Drafting)` | 42 | 42 | pending | complete | Human approval required |
| Saddam H. | `Resume_Saddam_H.(Distrubition)` | 41 | 41 | pending | complete | Human approval required |
| Saddam H. | `Resume_Saddam_H.(Solar PV)` | 44 | 44 | pending | complete | Human approval required |
| TAHSIN MUHTADY MAHI | `Resume_Mahi(FPGA,VLSI)` | 43 | 43* | pending | manual | Generate/review before auto-match |
| TAHSIN MUHTADY MAHI | `Resume_Mahi(Solar PV)` | 39 | 39 | pending | complete | Human approval required |
| Test Istiaque | `Test Istiaque — Base Resume` | 45 | 45 | approved | manual | Ready if test account is intentionally in scope |
| akash | `akash — Base Resume` | 42 | 42 | pending | complete | Human approval required |

\* A profile with an empty `keyword_states` array uses its stored `keywords` array as the active fallback. The inventory preserves the distinction so an operator can see which profiles still need a clean agent-generated review.

### Profile rules to preserve

These rules are editable manager/admin policy, not facts to invent or silently rewrite.

**Avirup — CAD**

- Reject roles requiring more than 5 years of experience.
- Reject senior, lead, manager, principal, or director roles unless the posting accepts candidates with 5 years or less.
- Prefer junior, associate, technician, drafter, designer, and production roles involving AutoCAD, Civil 3D, utility, telecom, civil, infrastructure, GIS/CAD, permitting, construction drawings, as-builts, QA/QC, or quantity takeoffs.
- Revit, SolidWorks, MicroStation, and Bluebeam are secondary tools unless the posting makes one the primary requirement; do not reject solely because one appears.

**Avirup — GIS**

- Reject roles requiring more than 5 years of experience.
- Reject senior, lead, manager, principal, or director roles unless the posting clearly accepts candidates with 5 years or less.
- Prefer GIS roles involving ArcGIS, utility, municipal, infrastructure, field data, mapping, geodatabases, automation, or QA/QC.
- Reject roles focused primarily on data science, remote-sensing research, or unrelated software engineering.
- Candidate is open to U.S. relocation.

**Avirup — OSP**

- Reject roles requiring more than 5 years of experience.
- Reject senior, manager, principal, and construction-management roles unless the experience requirement is 5 years or less.
- Prefer OSP/fiber design, drafting, permitting, GIS, route planning, QA/QC, field verification, and construction-ready documentation.
- Reject PE-required roles unless the posting explicitly allows candidates without a PE license.
- Candidate is open to U.S. relocation.

**Bhaskar — CAD**

- Reject roles requiring more than 5 years unless the posting clearly accepts a junior or early-career candidate.
- Reject senior, lead, principal, manager, director, and drafting-management roles when they require more than 5 years.
- Prioritize AutoCAD, CAD production, technical drawings, utility/telecom/infrastructure, OSP, permitting, plan sets, as-builts, redlines, QA/QC, GIS/CAD, BOM/BOQ, and document control.
- Civil 3D, MicroStation, Bluebeam, Revit, and survey tools are adjacent unless primary; do not reject a role merely because one secondary tool is listed with AutoCAD.
- Candidate is open to U.S. relocation.

**Bhaskar — Mechanical Engineering**

- Prioritize entry-level and early-career mechanical design, project engineering, manufacturing support, engineering coordination, technical documentation, CAD, and infrastructure project roles.
- Reject roles requiring more than 5 years unless the posting clearly accepts a junior candidate.
- Reject senior, lead, principal, manager, director, and licensed-PE roles when the experience requirement exceeds 5 years.
- Reject roles where PLC programming, ladder logic, SCADA, robotics programming, machine-controls commissioning, HVAC design, FEA, CFD, or SolidWorks/Creo modeling is the primary day-one requirement. These are adjacent only when AutoCAD, documentation, project coordination, BOM/BOQ, or engineering management are substantial.
- Prefer employers willing to train on industry-specific software.
- Do not represent telecom/OSP work as factory mechanical design. Candidate has a Mechanical Engineering bachelor’s degree, an Engineering Management master’s degree, and professional CAD/infrastructure design experience.
- Candidate is open to U.S. relocation.

**Bhaskar — OSP**

- Reject roles requiring more than 5 years unless the posting clearly accepts a junior or early-career candidate.
- Reject senior, lead, principal, manager, director, and construction-management roles when they require more than 5 years.
- Reject PE-required roles, telecom construction-superintendent responsibilities, and direct field-crew management.
- Prioritize OSP design, fiber design, route planning, AutoCAD, permitting, ROW, joint use, pole attachments, HLD/LLD, QA/QC, as-builts, GIS/CAD, BOM/BOQ, and construction-ready documentation.
- GIS, Civil 3D, MicroStation, and field verification are adjacent matches; do not require them when the posting is primarily OSP design.
- Candidate is open to U.S. relocation.

The remaining profiles currently have no additional free-text rules in the export. Do not create rules from stereotypes or from a single keyword. Use their resume content, approved profile terms, candidate source-of-truth data, and human review. A manager should add explicit exclusions before a new scheduled run if a profile needs them.

## 2. Paste-ready low-cost AI worker prompt

Use this prompt with the job corpus and a read-only or controlled service connection to Neon. The worker may use `gemini-2.5-flash-lite` for high-volume classification and ranking. It must not receive database credentials in a prompt, output, log, or model context.

```text
You are TalentOS Active Base Resume Job Matcher.

Goal: find the strongest recent jobs in the supplied TalentOS job corpus for every active candidate and every active, reviewable base resume. Produce a ranked recommendation report. Only create internal TalentOS application-queue records when the operator explicitly sets ALLOW_QUEUE_WRITES=true. Never submit an application to a job board, send email, change candidate profile data, or fabricate qualifications.

Run parameters:
  LOOKBACK_HOURS=168                 # jobs entered the system during this run window
  POSTED_WITHIN_DAYS=7               # public posting freshness gate
  PRIORITIZE_POSTED_WITHIN_HOURS=72
  TARGET_NEW_PER_CANDIDATE=20        # target, not a filler requirement
  MAX_NEW_PER_CANDIDATE=50           # hard cap per candidate for one run
  ALLOW_QUEUE_WRITES=false           # false for review; true only after explicit approval
  ASSIGN_TO_AE_EMAIL=akash@skarion.com # resolve to an active application-engineer user
  MODEL=gemini-2.5-flash-lite

Rules:

1. Load candidates where lower(status) = 'active'. Ignore dropped, inactive, archived,
   test-excluded, and deleted candidates unless the operator explicitly includes them.

2. Load base_resumes for each active candidate. Ignore archived/disabled resumes. Treat
   each base resume as a separate profile. Never use a candidate's CAD profile to justify
   a mechanical, GIS, OSP, network, solar, or FPGA match unless the selected profile says
   so and the resume provides evidence.

3. Load candidate_resume_search_profiles by base_resume_id. Read:
   keywords, keyword_states, additional_rules, rules_json, review_status,
   generation_status, profile_version, approved_profile_version,
   resume_content_hash, last_generated_at, last_generation_model,
   last_generation_prompt_version, and last_generation_error.
   If keyword_states exists, exclude terms whose state is dismissed. If it is empty,
   use the stored keywords array as a fallback and mark the profile as legacy-state.

4. Only auto-match a profile when review_status='approved', approved_profile_version
   equals profile_version, and the current base-resume content hash equals
   resume_content_hash. Otherwise return it in a profile-readiness report and do not
   create an application. A manager/admin must review or regenerate stale profiles.

5. Read only evidence needed to match: base-resume content, verified skills,
   work authorization/visa status, preferred locations, and explicit profile rules.
   Candidate personal/private notes, personal email content, medical information,
   unrelated mailbox messages, and demographic information are not matching evidence.

6. Load recent jobs from the canonical jobs table. Public posting freshness is based on
   jobs.posted_at, not last_seen_at or ingestion created_at. Require is_active=true,
   a valid title, a company or source, a trustworthy posted_at inside the last 7 days,
   and enough description text to verify fit. Missing/invalid posted_at or a description
   shorter than about 120 characters goes to NEEDS_HUMAN_VERIFICATION, not auto-queue.

7. Deduplicate before AI scoring. Prefer external_job_id, ref_id, source_url, or apply_url.
   Otherwise use normalized company + title + location. Preserve the freshest canonical
   job. Do not create duplicate applications for a candidate/job pair. A job may be
   recommended to multiple candidates only when each has an independent strong fit.
   For one candidate/job, choose one best base resume unless an AE explicitly requests
   multiple versions.

8. Deterministic prefilter first, cheap AI second. Eliminate obvious domain mismatches,
   closed/expired jobs, unsupported mandatory licenses/certifications, clear seniority or
   years-of-experience conflicts, explicit citizenship/clearance conflicts, and roles
   whose primary work is unrelated to the selected profile. Do not reject solely because
   a secondary tool is listed. If a requirement is ambiguous, classify as REVIEW rather
   than inventing a pass or fail.

9. For surviving jobs, output a structured evaluation. Search keywords are discovery
   signals, not proof. Evidence must point to actual resume text or a verified field.
   Score as follows:
     title and role alignment                         0-30
     demonstrated tools/skills/domain coverage       0-25
     responsibilities and deliverables fit           0-20
     seniority and experience fit                    0-10
     location/work authorization fit                 0-10
     posting freshness and application viability     0-5
     subtract explicit contradiction/duplicate risk  0-25
   A hard-gate failure cannot be rescued by a high keyword score.
   85-100 = TOP_MATCH; 75-84 = REVIEWABLE_MATCH; below 75 = omit.

10. Apply profile additional_rules exactly. A rule such as “reject more than 5 years”
    is a hard gate when the job explicitly requires more than five years. If a posting
    says “preferred” rather than “required,” record the distinction and send to review
    when it materially affects fit. Never infer years of experience from age, graduation
    year, or a vague seniority label.

11. Rank by interview likelihood, not keyword count. Prefer direct title alignment,
    clear responsibilities, demonstrated tools, realistic seniority, recent posting,
    complete description, and viable location/work arrangement. Do not pad the result.
    Return fewer than 20 when fewer than 20 pass the quality gate. Do not exceed 50 new
    recommendations per candidate in one run.

12. Return JSON only with this shape:
   {
     "run_id": "...",
     "generated_at": "ISO-8601",
     "profiles": [{
       "candidate_id": "...",
       "base_resume_id": "...",
       "profile_status": "ready|needs_review|stale|failed",
       "recommendations": [{
         "job_id": "...",
         "score": 0,
         "band": "TOP_MATCH|REVIEWABLE_MATCH",
         "primary_base_resume": true,
         "matched_terms": ["..."],
         "resume_evidence": ["short paraphrase with section/source"],
         "missing_or_uncertain": ["..."],
         "hard_gate_results": [{"rule":"...","result":"pass|fail|review","reason":"..."}],
         "reason": "one concise sentence",
         "duplicate_group_key": "...",
         "recommended_action": "queue_for_ae_review|needs_human_verification"
       }],
       "counts": {"top":0,"reviewable":0,"omitted":0}
     }],
     "global_skips": [{"job_id":"...","reason":"..."}],
     "errors": []
   }

13. If ALLOW_QUEUE_WRITES=false, write no TalentOS mutations. If true, use the existing
    server service/API, not ad-hoc SQL copied into the model. For an approved recommendation
    call the equivalent of approveCandidateJobMatch with the decision id, actor, selected
    base_resume_id, and resolved AE user. The created application must have:
      source_type='base_resume'
      the exact selected base_resume_id
      assigned_to_user_id equal to the configured AE
      ae_stage='in_ai_pipeline'
      resume_generation_status='queued'
      applied_at=NULL
      one application event
    Then call triggerAiWorkflowForApplication(applicationId, actorUserId,
    preferredBaseResumeId). Do not set AE Applied, applied_at, proof, or submission fields.

14. Verify every write: candidate/job/base-resume association, AE owner, target_jobs row,
    application_resume_versions row, application_packets row, application_ai_workflows
    row, and queued/running workflow state. A failed workflow must stay visible with its
    error and retry path; never silently report success.

15. The run is idempotent. Use a unique run key, candidate/job uniqueness, decision IDs,
    and automation idempotency keys. A retry may repair a failed workflow but must not
    create a second application or resurrect a manager-dismissed keyword.
```

## 3. Canonical data and code map

Use the current repository implementation rather than creating a second matching path.

| Need | Canonical source | Notes |
|---|---|---|
| Active candidate scope | `candidates.status` | Only `active` candidates are in scope. |
| Resume evidence | `base_resumes.content` | Must match the selected `base_resume_id`. |
| Resume profile terms/rules | `candidate_resume_search_profiles` | Respect `keyword_states`, versions, hashes, review status, and rules. |
| Candidate/job evaluation | `src/lib/candidateJobMatcher.ts` | Existing deterministic hard gates and score bands. |
| Scheduled matcher | `src/server/services/candidateJobMatcherService.ts` | Current default: seven-day posting window, top 50 per candidate, approved/current profile required. |
| Keyword generation | `src/server/services/baseResumeJobSearchKeywordService.ts` | Agent ID: `BaseResume_TO_JobSearchKeyword`; current intended limit is 30–48. |
| Canonical job corpus | `jobs` | `posted_at` is the freshness field; use title, company, location, source, source_url, apply_url, external_job_id, ref_id, descriptions, and active flag. |
| Staged Apify ingestion | `job_agent_staged_jobs` and `src/server/services/jobAgentService.ts` | Use only rows that are not duplicate/excluded and have a trustworthy posting date before import/matching. |
| Apify keyword groups | `job_agent_keyword_groups` | Seven active groups are included in the CSV source compilation. |
| OpenJobs defaults | `scripts/openjobdata_export.py`, `scripts/openjobdata_ingest.py`, `scripts/EEE_job_search.py`, `scripts/accounting_finance_job_search.py` | Legacy definitions are discovery sources, not qualification evidence. |
| Existing candidate/job target | `target_jobs` | Unique on `(candidate_id, job_id)`. Store parsed description and fit score through the repository/service. |
| Application queue | `applications` and `src/server/repositories/applicationsRepository.ts` | Unique candidate/job application path; preserve stage/status fields. |
| Match audit | `candidate_job_match_runs`, `candidate_job_match_decisions`, `candidate_job_match_rule_results` | Store scores, hard gates, matched terms, rules, freshness cutoff, and profile version. |
| Tailored resume workflow | `src/server/services/applicationAiWorkflowService.ts` | Call `triggerAiWorkflowForApplication` with the selected base resume. |
| AI workflow dispatch | `application_ai_workflows` and dispatcher routes | Verify stages/artifacts; retries must be idempotent. |

### Important current behavior

The current deterministic matcher is intentionally stricter than a raw keyword search. It reads only profiles with `review_status = 'approved'`, matching `approved_profile_version = profile_version`, and a current resume content hash. Profiles marked `pending`, `needs_review`, `stale`, or `failed` must be reported as not ready instead of being auto-logged.

The current service selects at most 50 recommendations per candidate and chooses one winning base resume per job. It does not require a minimum of 20; that is correct. Twenty is a target only when enough fresh, defensible matches exist.

## 4. Cheap-AI operating design for thousands of jobs

Do not send thousands of complete job descriptions and every resume to the model in one prompt. Use a staged pipeline:

1. **SQL/source prefilter:** active jobs, valid posting date, description present, source dedupe, and a seven-day freshness window.
2. **Deterministic lexical prefilter:** title/domain overlap against active terms and profile target roles. Keep a generous candidate pool, for example the best 100–250 jobs per profile, so a false negative is recoverable.
3. **Flash Lite batch classification:** send 25–50 compact job records at a time with one profile summary. Request JSON-only evaluations using the schema above. Use low temperature and a strict response schema if the provider supports it.
4. **Deterministic validation:** reject malformed JSON, unknown job IDs, unsupported score ranges, invented evidence, missing hard-gate results, and recommendations outside the seven-day window.
5. **Deduplicate/rank in code:** do not ask the model to enforce database uniqueness. Select the top distinct jobs per candidate and choose the best base resume for duplicate candidates/jobs.
6. **Human review or controlled queue write:** default to report-only. Queue writes require an explicit run flag and a verified service actor.

Use `gemini-2.5-flash-lite` for shortlist classification, duplicate grouping, and concise reasons. Reserve a more expensive model for a small exception queue only: ambiguous license/visa interpretation, conflicting evidence, or human-requested second review. Never use an AI response as authority to override a manager-dismissed term, a hard rule, or an explicit database uniqueness constraint.

## 5. Matching and deduplication edge cases

- A syndicated job may appear from multiple sources. Keep one canonical job and record every source in audit metadata.
- A job can be a strong match for Avirup GIS and Avirup CAD; choose the profile with the strongest evidence and do not create two applications for the same candidate/job.
- The same job may legitimately be recommended for two different candidates, but prefer distinct jobs when quality is comparable.
- “Posted today” can be a scrape timestamp, not a public posting date. Missing or suspicious dates require human verification.
- “Preferred” qualifications are not the same as “required.” Preserve that distinction in the decision.
- A generic keyword such as “engineer,” “designer,” “Python,” or “project” is not enough for a recommendation.
- A senior title with a junior-friendly description must still be checked against the profile’s explicit seniority rule.
- Unknown work authorization, clearance, license, or location must be REVIEW, not an invented pass.
- A job requiring a tool that is adjacent to the resume may still pass when the job’s core responsibilities match; do not use one secondary tool as an automatic rejection.
- Old applications, target jobs, rejected jobs, and manager-dismissed recommendations must not be recreated by a rerun.
- If a base resume changes after profile approval, mark the profile stale and require regeneration/review before matching.
- Test accounts such as `Test Istiaque` and `akash` are active in the snapshot but should be excluded from production runs unless the operator explicitly includes them.

## 6. Queue-write checklist

Before enabling writes:

- Confirm the run is not a dry run and the operator explicitly requested logging.
- Resolve the configured AE to an active `application_engineer` profile.
- Confirm the selected base resume profile is approved/current.
- Confirm the job is fresh, active, canonical, and not already present for the candidate.
- Use the existing match approval/application service so events, target jobs, resume versions, packets, and AI workflows are created consistently.
- Keep the first AE stage at `in_ai_pipeline`; do not mark the job applied.
- Confirm `applied_at` is NULL and no proof/submission fields were set.
- Verify `application_ai_workflows` is queued/running and the selected base resume is carried into the workflow.
- Record the matcher run ID, decision ID, score, reason, and profile version.
- Return counts for created, skipped duplicate, rejected hard-gate, needs-review, and workflow-failed rows.

## 7. Suggested schedule

Run discovery frequently but write conservatively:

- Every 6 hours: ingest/dedupe jobs and update the staged corpus.
- Every 6–12 hours: run the report-only matcher over postings from the last seven days.
- Daily: have a manager approve profiles changed since the last run and review the top recommendations.
- After approval: run a controlled queue-write pass for 20–50 top matches per active candidate, fewer when quality is insufficient.
- Every run: retry failed AI workflows idempotently and alert on stale profiles, missing posting dates, duplicate spikes, malformed AI output, or workflow error growth.

## 8. Acceptance tests

1. An inactive candidate produces no recommendations or applications.
2. An unapproved or stale profile appears in readiness warnings and produces no queue write.
3. A job older than seven days is omitted even if it was ingested recently.
4. A missing-posted-date job is reported for human verification, not auto-logged.
5. A job requiring more than five years is rejected for Avirup CAD/GIS/OSP and Bhaskar profiles where the rule applies.
6. A senior/manager role is rejected or reviewed according to the selected profile’s rule.
7. A dismissed keyword is never used as positive evidence or resurrected by a rerun.
8. The same canonical job cannot create two applications for one candidate.
9. A successful queue write has the exact candidate, job, base resume, AE owner, `in_ai_pipeline` stage, `resume_generation_status='queued'`, `applied_at=NULL`, target job, resume version, packet, workflow, and event.
10. A retry repairs a failed workflow without creating a second application.
11. A dry run makes zero database mutations.
12. The final report is valid JSON and contains no database URL, OAuth secret, private mailbox content, or unsupported claim.

## 9. Operator handoff

The keyword CSV is the term-level input. The live database remains the source of truth for profile approval, resume content, rule edits, job freshness, application uniqueness, AE ownership, and workflow state. If a profile needs better coverage, update the base resume/profile in TalentOS, approve it, then rerun the matcher. Do not hand-edit an exported CSV and treat it as a production profile.

The safest first run is report-only: generate the JSON recommendation report, inspect the top matches per base resume, approve/reject the recommendations, and only then set `ALLOW_QUEUE_WRITES=true` for the controlled queue pass.
