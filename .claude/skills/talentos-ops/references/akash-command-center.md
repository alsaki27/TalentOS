# Akash / AE-Manager Command Center

This is the standalone reference for anything asked by or about Akash (the AE department manager) or general AE-management questions: which roles to chase, who to hand them to, how many applications each application engineer (AE) actually completed, and whose resume tailoring holds up. It's extracted from Section 21 of `TALENTOS_MASTER_PLAYBOOK.md` — read that file's Section 2 (data model) and Section 3 (operating contract) first if you haven't already, since every query below depends on those table definitions and the dry-run/confirmation discipline.

Resolve Akash's own `profiles.user_id` once per session (by email, `role IN ('manager','admin')`) and reuse it as the `actor`/`assigned_by_user_id` on every write below — don't re-resolve it on every call.

## 21.1 Identify high-ROI roles (read-only)

**When to use:** "what should we chase right now," "show me the best jobs open right now," "what's worth an AE's time today."

Query: `scripts/identify_high_roi_roles.sql`. Ranks `candidate_job_match_decisions` where `outcome = 'recommended'` and nothing has actioned it yet, tier A before tier B, freshest first. Sanity-check a handful of results against the live job posting before acting on the list — a stalled scraper can leave `jobs.is_active` stale.

## 21.2 Assign an application to an AE (write — requires confirmation)

**When to use:** "give this to [AE name]," "assign these five to the team," "who should take this one."

Before assigning: check 21.5 (bandwidth snapshot) so you're not piling onto someone already overloaded. This is an ownership change (`applications.assigned_to_user_id`/`assigned_by_user_id`/`assignment_note`/`assignment_due_at`), not a stage change — don't also write `application_stage_history` unless the stage is genuinely moving. Log the assignment to `audit_logs`. See `scripts/assign_application_to_ae.sql` for the parameterized shape.

## 21.3 How many applications did each AE actually do (read-only, but read the caveat)

**When to use:** "how many applications did [AE] submit this week," "give me AE throughput for the last 3 days," any productivity count.

**The one thing that will make this wrong if skipped:** `applications.ae_applied_at` / `ae_stage_updated_at` include migration-backfilled timestamps that can land inside a recent window and inflate the count. Use `application_stage_history` filtered to `source = 'queue'`, excluding `source = 'migration'` — that's the only trustworthy source, and it's exactly the caveat the org's own `EXECUTIVE_AE_BANDWIDTH_REPORT_2026-08-11.md` had to call out explicitly after the naive count was wrong once already. See `scripts/ae_application_report.sql`. Report both numbers side by side with the gap explained if Akash asks for detail — don't just silently swap one for the other.

Watch for duplicate-looking identities (two accounts with the same display name but different logins) — flag rather than silently merge them.

## 21.4 Who's tailoring best / worst (read-only, needs a spot-check before trusting)

**When to use:** "whose resumes are actually good," "who should I coach," "quality check across the team."

Join `application_resume_versions` (`ats_score`, `truth_score`, `one_page_fit_score` — all on a **0–10 scale**, not the 0–100 match-score scale) through `application_packets.final_resume_version_id` to `application_packets.reviewed_by`/`approved_by`/`sent_by` — that's the person accountable for the packet, not `application_resume_versions.created_by` (frequently the system/AI actor for the first draft). See `scripts/ae_tailoring_quality_report.sql`.

**This attribution join has not been confirmed against live data as of this writing.** Before presenting a "worst AE" ranking as fact, spot-check 10–20 real applications and confirm the attributed name is actually who worked the ticket. Also never act on a low average alone — pair it with an integrity audit (playbook Section 14.6) on a few of that AE's real applications; a low score can mean they were handed the hardest lanes, not that they're careless.

## 21.5 Live bandwidth / ownership snapshot (read-only)

**When to use:** "who's overloaded," "what's our open queue look like," "is anything stuck unassigned."

Reproduces the org's own `EXECUTIVE_AE_BANDWIDTH_REPORT_2026-08-11.md` on demand: current open ownership by AE and stage, plus the unassigned `in_ai_pipeline` backlog — the exact imbalance that report caught (279 unassigned vs. 44 assigned to active AEs). See `scripts/ae_bandwidth_snapshot.sql`.

## 21.6 The daily digest

**When to use:** "give me Akash's morning summary," "what does he need to see today."

Compose 21.1 (top 10–20 unassigned high-ROI roles) + 21.3 (yesterday's per-AE counts, `source='queue'` only) + 21.4 (rolling 7-day quality averages, low-truth flags) + 21.5 (current ownership + unassigned backlog), plus a routing-backlog callout whenever the unassigned `in_ai_pipeline` count exceeds the total actively-owned count. Every number must be reproducible from the underlying query on request — never hand-summarize without it.
