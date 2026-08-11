# Executive AE bandwidth report

Snapshot: 2026-08-11 23:06 UTC / 19:06 EDT  
Measurement window: rolling 72 hours, 2026-08-08 23:06 UTC through the snapshot time  
Source of truth: live Neon `applications` and `application_stage_history` tables  
Scope: active profiles with `role = 'application_engineer'`

## Executive readout

- **14 active AE accounts** exist in TalentOS.
- **8 active AE accounts currently own open queue work.**
- **6 active AE accounts recorded real queue-stage activity in the last 3 days.**
- **8 active AE accounts recorded no queue-stage transition in the window.**
- The team made **90 review handoffs** (`ready_for_review → ready_for_application`) and **119 AE-applied transitions** (`ready_for_review/ready_for_application → applied`) across **129 unique tickets**.
- The current queue has **344 open tickets**: 45 ready for AE review, 10 ready for AE application, and 289 in the AI pipeline.
- **279 of the 289 AI-pipeline tickets are unassigned.** Only 10 AI-pipeline tickets are assigned to active AEs.
- Only **44 open tickets are assigned to active AE accounts**. The remaining 300 are unassigned or assigned to admin, inactive, or test accounts.

### Bottom line

The current constraint is not a lack of AE accounts. It is routing and pipeline ownership. The human-actionable queue is relatively small compared with the AI-pipeline backlog, but most AI-pipeline tickets are not assigned to anyone. The first bandwidth improvement should be to route eligible AI-pipeline tickets to the intended AE manager/owner and remove inactive/test/admin ownership from production work.

## Activity by active AE

“Reviewed” below means a real queue transition from `ready_for_review` to `ready_for_application`. “Applied” means a real queue transition to `applied`. The counts use `application_stage_history.source = 'queue'` and exclude migration-generated history so old bulk data is not mistaken for current work.

| Active AE account | Current open owned | In review | In application | AI pipeline | Reviewed in 72h | Applied in 72h | Total queue actions | Bandwidth signal |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Avimanyue Bepari (`avimanyue@skarion.com`) | 23 | 21 | 0 | 2 | 0 | 25 | 25 | High applied throughput; 21 review tickets remain |
| Golam Muin-U-Ddin Chishti (`chishti055@gmail.com`) | 10 | 1 | 9 | 0 | 0 | 0 | 0 | Holding 10 tickets; no recent queue transition |
| Mehedee Hasan Shikhon (`mehedee@skarion.com`) | 4 | 4 | 0 | 0 | 0 | 29 | 29 | High applied throughput; 4 review tickets remain |
| Akter Zaman (`akter@skarion.com`) | 3 | 2 | 0 | 1 | 39 | 0 | 39 | High review throughput; 2 review tickets remain |
| Amimul Ahasan Amim (`amimul@skarion.com`) | 1 | 0 | 1 | 0 | 0 | 42 | 42 | High applied throughput; little current backlog |
| Golam Muin-U-Ddin Chishti (`golam@skarion.com`) | 1 | 0 | 0 | 1 | 0 | 23 | 23 | Separate active account with applied activity |
| Rianul Amin (`asf@gmail.com`) | 1 | 1 | 0 | 0 | 0 | 0 | 0 | Holding 1 review ticket; no recent transition |
| Sareta Ridwana (`sareta@skarion.com`) | 1 | 1 | 0 | 0 | 51 | 0 | 51 | Highest review throughput; 1 review ticket remains |
| Abdur Rahamn Sakib (`abdur@skarion.com`) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | No current ownership or recent activity |
| Sad Yeamin Sayem (`sad@skarion.com`) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | No current ownership or recent activity |
| Saki Test AE (`saki@skarion.com`) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | Test account/no current ownership |
| Wafia Sadiqa (`wafia@skarion.com`) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | No current ownership or recent activity |
| nuzhat A (`nuzhat@skarion.com`) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | No current ownership or recent activity |

### Team distribution

- **Review work:** Sareta 51 and Akter 39 account for all 90 review handoffs in the window.
- **Applied work:** Amimul 42, Mehedee 29, Avimanyue 25, and Golam (`golam@skarion.com`) 23 account for all 119 applied transitions.
- **No recent transitions:** the second Golam account (`chishti055@gmail.com`), Rianul, Abdur, Sad, Saki Test AE, Wafia, and nuzhat had no qualifying queue-stage transition during the window.
- The two Golam accounts have the same display name but different logins. Keep them separate in operational reporting until the duplicate identity is intentionally merged or disabled.

## Current queue load

| Queue stage | Current tickets |
|---|---:|
| Ready for AE Review | 45 |
| Ready for AE Application | 10 |
| AI Pipeline | 289 |
| **Open total** | **344** |
| Applied history total | 4,498 |

### Ownership problem

Of the 344 open tickets:

- **279** are in AI Pipeline and unassigned.
- **44** are assigned to active AE accounts.
- **21** are assigned to inactive, test, or admin accounts.

The queue therefore understates individual AE workload if someone is looking only at the “Mine” filter, while the AI Pipeline card represents work that has not been routed to a human owner. A manager should treat the 279 unassigned AI-pipeline tickets as a routing backlog, not as completed AI work.

## Data-quality warning

The application columns `ae_reviewed_at` and `ae_applied_at` currently produce larger counts than the queue-stage history. For example, those columns show legacy-stamped activity for Sareta and Akter that does not correspond to current `source = 'queue'` transitions. Migration records were written inside the 72-hour timestamp window, so counting those columns alone would inflate current team throughput.

For executive throughput, use:

```sql
application_stage_history.source = 'queue'
AND changed_at >= now() - interval '3 days'
```

For audit/debugging, retain both measures:

- **Operational throughput:** queue stage history, excluding migration.
- **Stored attribution fields:** `ae_reviewed_*` and `ae_applied_*`, useful for record attribution but currently contaminated by legacy/migration timestamps.

## Recommended management actions

1. Assign the 279 unassigned AI-pipeline tickets to the intended manager/AE routing owner or explicitly mark them as system-owned until ready for review.
2. Keep the 45 ready-for-review and 10 ready-for-application tickets visible as the immediate human workload.
3. Rebalance Avimanyue’s 21 review tickets and the second Golam account’s 10 tickets before adding more work to those owners.
4. Use Sareta and Akter as the current review-capacity leaders and Amimul/Mehedee/Avimanyue as applied-throughput leaders, subject to quality review.
5. Decide whether `chishti055@gmail.com` and `golam@skarion.com` are intentionally separate AE accounts. Duplicate display names make executive reporting and reassignment ambiguous.
6. Repair the legacy attribution problem so future reports can rely on one canonical stage-event stream. Do not backfill current throughput by simply copying migration rows into the queue history.
7. Add dashboard metrics for “active AE current ownership,” “unassigned AI pipeline,” “queue actions in 72h,” and “unique tickets touched,” with a source filter that distinguishes `queue`, `ai_pipeline`, `email_ai`, and `migration`.

## Reproducible report definitions

```sql
-- Active AE headcount
SELECT count(*)
FROM profiles
WHERE is_active = true
  AND role = 'application_engineer';

-- Human queue throughput in a rolling 72-hour window
SELECT changed_by_user_id,
       changed_by_name,
       count(DISTINCT application_id) FILTER (
         WHERE to_stage = 'ready_for_application'
       ) AS reviewed_handoffs,
       count(DISTINCT application_id) FILTER (
         WHERE to_stage = 'applied'
       ) AS applied_transitions,
       count(DISTINCT application_id) AS unique_tickets_touched
FROM application_stage_history
WHERE source = 'queue'
  AND changed_at >= now() - interval '3 days'
GROUP BY changed_by_user_id, changed_by_name;

-- Current open queue
SELECT ae_stage, count(*)
FROM applications
WHERE ae_stage <> 'applied'
GROUP BY ae_stage;
```

This is a read-only snapshot; no queue records or ownership assignments were changed while producing it.
