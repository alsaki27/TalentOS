# TalentOS MCP Connector

## Endpoint

```text
https://talent.skarion.com/api/mcp
```

The endpoint uses MCP Streamable HTTP-style JSON-RPC and a separate `mcp_live_*` bearer key. MCP credentials are unrelated to browser-extension keys, public REST keys, AI-provider keys, or candidate portal tokens.

## Create a key

Managers and admins can open `/account/mcp-keys`, create a named key, select scopes, and copy the plaintext key once. TalentOS stores only a SHA-256 hash. Revoke a key from the same page.

Example client configuration:

```json
{
  "mcpServers": {
    "talentos": {
      "url": "https://talent.skarion.com/api/mcp",
      "headers": {
        "Authorization": "Bearer mcp_live_COPY_KEY_HERE"
      }
    }
  }
}
```

### Claude Desktop with `mcp-remote`

Claude Desktop should force the Streamable HTTP transport. Without the
explicit transport flag, `mcp-remote` may try SSE after an application-level
JSON-RPC error, but this endpoint is HTTP-only.

```json
{
  "mcpServers": {
    "talentos": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://talent.skarion.com/api/mcp",
        "--transport",
        "http",
        "--header",
        "Authorization: Bearer ${TALENTOS_MCP_KEY}"
      ],
      "env": {
        "TALENTOS_MCP_KEY": "mcp_live_COPY_KEY_HERE"
      }
    }
  }
}
```

### Claude Code

Claude Code reads `.mcp.json` at the repo root and expands `${VAR}` references
against the shell environment, so the key itself never needs to be committed
or typed into a prompt:

```json
{
  "mcpServers": {
    "talentos": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://talent.skarion.com/api/mcp",
        "--transport",
        "http",
        "--header",
        "Authorization: Bearer ${TALENTOS_MCP_KEY}"
      ]
    }
  }
}
```

Export the key before launching Claude Code (`export TALENTOS_MCP_KEY=mcp_live_...`
on macOS/Linux, `$env:TALENTOS_MCP_KEY = "mcp_live_..."` in PowerShell), then
run `/mcp` inside Claude Code (or `claude mcp list` outside it) to confirm the
connection. This repo also ships the `talentos-ops` Claude Skill
(`.claude/skills/talentos-ops/`), which documents which of the tools below to
use for AE-manager reporting and assignment requests, and what's still a gap.

## Current tools

- `list_active_candidates`
- `list_recent_jobs`
- `get_candidate_base_resumes`
- `list_applications`
- `get_daily_ae_summary`
- `get_ai_pipeline_status`
- `create_application`
- `rank_jobs_for_candidate`
- `find_duplicate_applications`
- `find_missing_sharepoint_exports`
- `change_application_stage`
- `retry_application_workflow`

`create_application` is idempotent, requires candidate/job/base-resume IDs, starts at `in_ai_pipeline`, and never marks a job applied. It returns the existing record for a duplicate candidate/job or idempotency key.

`rank_jobs_for_candidate` compares fresh, unlogged jobs against every available base resume and returns the winning resume, score, and evidence terms. It is a deterministic prefilter intended to give an external model a smaller, explainable candidate set.

Stage changes are restricted to the canonical stage vocabulary and write `application_stage_history`. Workflow retries call the existing application workflow service. SharePoint audits look for a created SharePoint export on applied or later-stage applications.

## Scopes

Read scopes include candidate, resume, job, matching, application, analytics, workflow, and email access. Write scopes are separate for application creation, assignment, stage changes, comments, workflow retry, and resume regeneration. Grant read-only scopes to exploratory agents and add write scopes only to trusted automation clients.

## Audit and safety

Every authenticated tool call writes to `mcp_audit_events` with request ID, tool, action, scopes, result, duration, and relevant entity IDs. Secrets and resume/email bodies are not written to the audit log. The connector does not expose SQL execution or raw credentials.

## Next implementation slice

The next tools should reuse the existing application workflow service rather than inserting workflow rows directly:

1. `rank_jobs_for_candidate` with base-resume evidence and freshness scoring.
2. `create_application_from_match` with selected base resume and owner.
3. `retry_application_workflow` and `get_workflow_result`.
4. Duplicate, SharePoint-export, and missing-tailored-resume audits.
5. Stage-change and note tools with explicit confirmation and stage-history writes.

All bulk tools should require an idempotency key, return per-record results, and enforce active-candidate, fresh-job, duplicate, and canonical `application_stage` rules server-side.
