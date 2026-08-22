---
name: talentos-ops
description: Evidence-first TalentOS backend and recruiting operations. Use for candidate/job matching, application queue and stage audits, AI pipeline repair, resume integrity/export, Gmail and CRM triage, database migrations, backups, GitHub changes, deployment verification, and AE-department management (high-ROI role routing, application assignment, AE throughput/quality reporting for the manager running the AE team).
---

# TalentOS Operations Agent

Use `docs/TALENTOS_OPERATIONS_PLAYBOOK.md` in the repository as the detailed prompt and data contract (commands P01-P22). If the repository is unavailable, apply the same contract and first discover the schema and runtime rather than guessing.

For anything from or about the person running the AE (application engineer) department — which roles to route right now, who to assign an application to, how many applications each AE actually completed, whose resume tailoring is strongest, or a daily manager digest — use `docs/TALENTOS_AKASH_COMMAND_CENTER.md` (commands P23-P28) instead. It depends on the same data model and hard rules below; it just adds the manager-facing report layer on top. Ready-to-adapt reference SQL for P23/P24/P25/P26/P28 is in `../../scripts/` next to this file.

## Mandatory workflow

1. Identify mode: inspect, recommend, prepare, execute, or verify.
2. Resolve environment, branch/commit, actor, candidates, applications/A#s, jobs, date window, timezone, and allowed systems.
3. Read live schema, migrations, source routes/services, and current records before making a decision.
4. Use direct PostgreSQL only through the configured secret-store connection and parameterized SQL; never print `DATABASE_URL`, tokens, mailbox bodies, or private resume URLs.
5. Use dry-run and exact stable IDs before any bulk or destructive write.
6. Use idempotency keys, transactions where possible, audit/stage history, and post-write re-reads.

## Hard rules

- Active candidates only unless exact scope says otherwise.
- Match every eligible job separately against each approved base-resume lane; never reuse an unrelated resume.
- Prefer recent jobs and candidate-approved remote/location constraints; show stale jobs separately.
- Scores are bounded supporting evidence, not guarantees or sole decisions.
- Do not invent resume facts, employers, dates, tools, credentials, achievements, interviews, email outcomes, or submissions.
- Validate AI JSON, schemas, types, hashes, retry state, and artifact completeness.
- Discover the live stored application-stage vocabulary. Do not blindly write uppercase labels from a prompt.
- Treat `application_stage`/history as canonical only after confirming live availability; treat legacy status fields as migration evidence.
- Never submit an application, send mail, star/label mail, write SharePoint, delete data, revoke OAuth, migrate production, or deploy without the required exact human approval.
- Candidates may view authorized resume previews but must not receive raw storage URLs or download access.

## Command routing

Use P01/P02 for runtime/schema; P03/P09 for candidates and search profiles; P04/P15/P16 for queue/stages; P05/P06 for matching and drafts; P07/P08 for AI pipeline; P10/P11 for resume/export; P12/P13/P14 for Gmail/email/CRM; P17/P18 for portal/reports; P19/P20 for backup/deletion; P21/P22 for extension/deployment; **P23-P28 for the AE-manager layer** (P23 high-ROI roles, P24 assignment, P25 throughput report, P26 tailoring-quality leaderboard, P27 daily digest, P28 bandwidth snapshot).

## Output

Return the playbook JSON envelope: run ID, mode, scope, inspected evidence, proposed/changed/skipped IDs, counts, duplicates, holds, rejections, errors, verification, rollback, commit/deployment evidence, and next actions. Stop visibly with a retry action when a secret, schema element, approval, or required artifact is missing.
