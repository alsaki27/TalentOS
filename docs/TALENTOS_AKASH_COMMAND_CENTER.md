# TalentOS Akash / AE-Manager Command Center

Version: 1.0
Prepared: 2026-08-19
Companion to: `docs/TALENTOS_OPERATIONS_PLAYBOOK.md` (read that file's Sections 1–4 first — mode classification, runtime map, authoritative data model, and the universal prompt envelope all apply here unchanged). This file adds six commands, numbered P23–P28 to continue that playbook's P01–P22 library, scoped specifically to Akash's job: running the AE (application engineer) department — seeing the strongest open roles, assigning them, and getting reporting he can defend in a meeting.

Source precedence, hard rules, AI quality/privacy policy, change/rollback discipline, and the canonical output envelope are all inherited from `TALENTOS_OPERATIONS_PLAYBOOK.md` — not restated here.

## Schema this command set depends on

`candidate_job_match_runs` / `candidate_job_match_decisions` (the matcher: `score` 0–100, `tier` A/B, `outcome`, `review_status`, `hard_gates`), `applications` (`assigned_to_user_id`, `assigned_by_user_id`, `assignment_note`, `assignment_due_at`, `application_stage`), `application_stage_history` (`from_stage`, `to_stage`, `changed_by_user_id`, `changed_by_name`, `source`, `changed_at` — **`source = 'queue'` is the only trustworthy throughput signal; exclude `'migration'`**), `application_resume_versions` (`ats_score`, `truth_score`, `one_page_fit_score` — a *separate* 0–10 scale from the matcher's 0–100 score, do not conflate them), `application_packets` (`reviewed_by`, `approved_by`, `sent_by` — the accountability chain for a tailored packet), `profiles` (`role = 'application_engineer'`, `is_active`).

Confirm all of the above against live `information_schema` before writing, per P02 — this file names them from `sql/neon_fixes/067_candidate_job_matcher.sql`, `070_application_stage_history.sql`, `023_resume_versions_ats_truth_scores.sql`, `086_resume_versions_page_fit_metrics.sql`, and the `applications`/`application_packets` definitions in `neon/migrations/0001_initial_schema.sql`.

### P23 — `identify_high_roi_roles`

```text
Surface the strongest open opportunities across all active candidates for Akash to route. Read candidate_job_match_decisions joined to jobs/candidates/base_resumes, filtered to outcome = 'recommended' and review_status IN ('pending','not_applicable') — i.e. not already actioned. Rank by tier (A before B) then score descending, then posting freshness. Exclude anything with a non-empty hard_gates that should already have been filtered upstream.

Spot-check a sample against the live job posting (still active, not expired) before treating the list as actionable — a stalled scraper can leave jobs.is_active stale. Return job_id, candidate, base_resume, company, title, location, posted_at, score, tier, matched_terms as evidence, hard_gates as risk, and application_id if one already exists. Do not create or mutate anything.
```

### P24 — `assign_application_to_ae`

```text
Assign one or more exact application IDs to a named, active application_engineer. Resolve the target AE's stable profiles.user_id (role = 'application_engineer', is_active = true) and Akash's own actor ID before writing. Check P28 (bandwidth snapshot) first so the assignment doesn't pile onto someone already over capacity, and show current ownership for that AE alongside the proposed assignment.

This is an ownership change (assigned_to_user_id / assigned_by_user_id / assignment_note / assignment_due_at), not a stage change by itself — only also write application_stage / application_stage_history if the stage is genuinely moving (e.g. in_ai_pipeline -> ready_for_review because the AE is picking it up now). Write an audit_logs row (action: assign_application, entity_type: application, metadata: assigned_to + reason). Require explicit confirmation before executing. Verify by re-reading assigned_to_user_id for the affected IDs and confirming the AE's queue view reflects it.
```

### P25 — `ae_application_report`

```text
Report how many applications each active AE actually completed in an exact time window and timezone. Do not count applications.ae_applied_at or ae_stage_updated_at directly — those columns carry migration-backfilled timestamps that can land inside a recent window and overstate current throughput. The trustworthy source is application_stage_history filtered to source = 'queue', excluding source = 'migration'.

Count distinct application_id per changed_by_user_id, splitting "reviewed" (to_stage = 'ready_for_application') from "applied" (to_stage = 'applied'). Never attribute AI/system-actor transitions to human productivity. If Akash asks for detail, also compute the stamped-column count side by side and report the gap explicitly rather than silently preferring one number. Flag any duplicate-looking AE identity (same display name, different login) instead of silently merging.
```

### P26 — `ae_tailoring_quality_report`

```text
Rank AEs by the measured quality of the resume packets they're accountable for, not just their volume. Join application_resume_versions (ats_score, truth_score, one_page_fit_score — a 0-10 scale, distinct from the matcher's 0-100 score) through application_packets.final_resume_version_id to application_packets.reviewed_by / approved_by / sent_by, in that preference order — this is the person accountable for the packet, not application_resume_versions.created_by, which is frequently the system/AI actor for the first draft.

This attribution join has not been confirmed against live data. Before presenting a "worst AE" ranking as fact, spot-check 10-20 real applications and confirm the attributed name is actually who worked the ticket — treat the first run as a draft for validation. Fold in application_resume_suggestions.truth_status = 'fabrication_risk' counts per reviewer as a second, independent signal. Never act on a low average alone: pair any "worst" result with a P10 tailored-resume audit on a few of that AE's real applications before a coaching conversation — a low score can mean they were handed the hardest candidates or lanes, not that they were careless.
```

### P27 — `akash_daily_digest`

```text
Compose one daily summary for Akash: the top 10-20 unassigned high-ROI roles (P23), yesterday's per-AE reviewed/applied counts using source='queue' only (P25), rolling 7-day tailoring-quality averages with any low-truth flags (P26), and the current ownership/unassigned-backlog snapshot (P28). Add an explicit routing-backlog callout whenever the unassigned in_ai_pipeline count exceeds the total actively-owned count — that specific imbalance (279 unassigned vs. 44 assigned) is what the org's own executive bandwidth report identified as the actual constraint, not AE headcount.

Every number in the digest must be reproducible by re-running its source query on request. Do not hand-summarize without the underlying query available. This command is read-only end to end.
```

### P28 — `ae_bandwidth_snapshot`

```text
Reproduce the org's own EXECUTIVE_AE_BANDWIDTH_REPORT_2026-08-11.md on demand instead of as a one-off hand-built document. Scope to active AEs (profiles.role = 'application_engineer', profiles.is_active = true). Report current open ownership grouped by AE and application_stage, excluding terminal stages (applied, rejected, withdrawn, closed, offer). Separately report the unassigned in_ai_pipeline backlog — applications at that stage with assigned_to_user_id IS NULL — since that backlog is what actually constrains throughput, not headcount.

Reconcile the total open-ticket count in the snapshot against a direct count of applications NOT IN terminal stages so the numbers always tie out. Flag inactive/admin/test accounts still holding open tickets separately from active-AE ownership, matching the distinction the original report made.
```

## Reference SQL

Runnable (parameterized) versions of P23, P24, P25, P26, and P28 live in `plugins/talentos-ops-agent/scripts/*.sql`. They are reference queries for a person or agent with vetted read access — not a tool to hand to an unscoped user, per the safe-tool-contract in `TALENTOS_OPERATIONS_PLAYBOOK.md` Section 11.
