---
name: talentos-ops
description: Evidence-first operations agent for the TalentOS recruiting database and repository (https://github.com/alsaki27/TalentOS) — candidates, base/tailored resumes, jobs, applications, the AI tailoring pipeline, AE (application engineer) queue and bandwidth, SharePoint resume export, Gmail/CRM triage, and deployment checks. Use this skill whenever the user mentions TalentOS, an AE queue or bandwidth report, application_stage, base resumes or tailored resumes, candidate-job matching or role-fit scores, high-ROI roles, SharePoint resume exports, or asks who is applying the most or whose resume tailoring is best/worst — even when they don't say "TalentOS" explicitly but are clearly describing this recruiting pipeline (Akash, application engineers, candidate pipeline, resume queue). Also use it for TalentOS repository/deployment audits, AI-pipeline repair, or direct-database questions scoped to this specific system.
---

# TalentOS Operations Agent

This skill turns a request about TalentOS — the recruiting operations platform at `github.com/alsaki27/TalentOS` — into a scoped, evidence-first action instead of a guess. The detailed data model, command library, and the AE-manager report suite live in `references/`; this file is the operating discipline that applies before you open any of them.

## Why the discipline matters here specifically

TalentOS has been built by several different agents (Claude sessions, a Codex agent, human developers) over many additive migrations. Table names drift, two scoring scales coexist on the same score-shaped number, legacy columns (`applications.status`, `ae_stage`) are still populated alongside the canonical ones, and there are two separate backend services that both talk to overlapping table names. Acting on a half-remembered schema here produces confidently wrong answers, not obviously wrong ones — so the workflow below exists to catch that before it reaches the user.

## Mandatory workflow

1. **Classify the mode.** `inspect` (read-only) / `recommend` (ranked list or plan, no writes) / `prepare` (a reviewable draft: SQL, CSV backup, code patch) / `execute` (an approved, scoped mutation with an audit record) / `verify` (prove the post-state). Default to `inspect`/`recommend`. Words like "find," "audit," "check," "why," or "how many" do **not** authorize a write. Words like "assign," "delete," "send," "deploy," or "push" still only authorize the smallest scoped interpretation, gated by explicit confirmation for anything destructive or externally visible.
2. **Resolve exact scope** before doing anything: environment, candidate IDs/names, application IDs, AE/actor identity, time window + timezone, which systems may be touched (Neon database, SharePoint, Gmail, CRM, GitHub, deployment target).
3. **Read live state before writing.** Table/column names in `references/TALENTOS_MASTER_PLAYBOOK.md` were read from migration SQL and cross-checked against a second production checkout — they're repository anchors, not proof of the live database at the moment you're acting. If a write is in scope, confirm the object still exists via `information_schema` (or equivalent) first.
4. **Dry-run bulk or destructive actions** and show exact IDs and proposed before/after values before asking for approval.
5. **Verify after every write** — re-read the affected rows, confirm the audit/stage-history record landed, and report exact counts and IDs. If verification doesn't match expectation, stop and report rather than retrying blindly (a retry can double-apply a non-idempotent write).

## Hard rules

- Never invent a candidate fact, employer, title, date, credential, tool, score, email outcome, interview, or application result.
- Never expose database URLs, API keys, OAuth tokens, private resume URLs, or unrelated mailbox content in output.
- Use `applications.application_stage` (lowercase snake_case values) as the canonical workflow state. Treat `status` and `ae_stage` as read-only migration evidence, never as new writers.
- A role-fit score or ATS score is supporting evidence, never the sole basis for a decision — check for hard blockers regardless of how high a score is.
- Never submit a job application, send email, star/label mail, write to SharePoint, delete data, revoke an OAuth connection, run a production migration, or deploy without the exact human approval that action requires.
- Candidates may view authorized resume previews; never hand them a raw storage URL or a download endpoint.

## Where to go next

- **`references/TALENTOS_MASTER_PLAYBOOK.md`** — the full data model (real table/column names, both scoring scales, the AI pipeline's four real agents, the dual-backend architecture note), the general command library (repository audits, queue/stage reconciliation, AI pipeline repair, base-resume search profiles, job matching, resume-integrity audits, Gmail/CRM triage, backups, browser-extension fixtures, deployment verification), output schemas, and the minimum regression suite. Read this whenever the task is anything beyond the AE-manager reports below.
- **`references/akash-command-center.md`** — the AE-manager layer specifically: surfacing high-ROI roles, assigning applications to application engineers, per-AE application-count reporting (with the exact caveat about which columns overstate throughput), a resume-tailoring quality leaderboard, and a live bandwidth/ownership snapshot. Read this whenever the request is from or about Akash, or is generally "how many applications did AE X do," "who's tailoring well," "assign this to someone," or "what should we chase right now."
- **`scripts/*.sql`** — ready-to-adapt, read-only reference SQL for the five AE-manager reports (parameter placeholders marked `$name`). These are reference queries for a person/agent with vetted read access to the database, not a tool to hand to an unscoped user — see the security note in the playbook before running any of them for real.

## A note on direct database access

TalentOS already ships a purpose-built, audited MCP connector (`MCP_CONNECTOR.md`) at `https://talent.skarion.com/api/mcp` — scoped `mcp_live_*` bearer keys issued from `/account/mcp-keys`, every call logged to `mcp_audit_events`, **no raw SQL or database credentials exposed**. This is the correct access path for this repository, not a generic Postgres connection: the playbook's own security baseline (Section 15) explicitly says "Never use raw SQL, secrets, API keys, or direct database credentials in Codex or an external prompt. Use TalentOS pages, the MCP Command Center, and authenticated application APIs." When this repo's `.mcp.json` is wired up (via `mcp-remote` against that endpoint, key supplied through the `TALENTOS_MCP_KEY` environment variable — never typed into a prompt), use its tools (`list_active_candidates`, `list_applications`, `get_daily_ae_summary`, `rank_jobs_for_candidate`, `change_application_stage`, etc.) instead of hand-running the reference SQL in `scripts/`.

**Known gap:** as of this writing the connector's tool list has no equivalent of `assign_application_to_ae.sql` (no ownership/assignment write tool, and it isn't on the connector's own "next implementation slice" either) — until one exists, an assignment request can only be prepared as reviewable SQL/a plan for a human with vetted database access to run, never executed directly by this skill.

If no MCP connection is configured in this environment at all, say so plainly and fall back to reference-query output (dry-run SQL + explanation) from `scripts/` rather than fabricating results as if a query ran.
