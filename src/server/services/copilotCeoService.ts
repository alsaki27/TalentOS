// src/server/services/copilotCeoService.ts
// Copilot CEO's periodic review: looks for repeating fill-plan mistakes and
// recurring unresolved fields, proposes prompt upgrades (human-approved via
// the existing agent_config_proposals / /job-ceo/proposals flow) and files
// action_items tickets for questions that need a one-time human answer.
// Modeled on job_ceo_orchestrator's proposal-writing block in jobCeoService.ts.

import { query, execute } from "@/server/db/neon";
import { callWithUsageTracking } from "@/lib/ai/routing";
import { runCopilotCeo } from "@/lib/ai/application-agents/copilotCeo";
import { AGENT_CONFIG_DEFAULTS } from "@/lib/ai/application-agents/constants";
import { createProposal } from "@/server/repositories/agentConfigProposalRepository";

const THROTTLE_MS = 60 * 60 * 1000; // don't run more than once an hour
const MIN_OCCURRENCES = 3;

async function shouldRun(): Promise<boolean> {
  const rows = await query<{ created_at: string }>(
    `SELECT created_at FROM ai_usage_events
     WHERE automation_id = 'copilot_ceo' AND outcome = 'success'
     ORDER BY created_at DESC LIMIT 1`
  );
  if (rows.length === 0) return true;
  return Date.now() - new Date(rows[0].created_at).getTime() > THROTTLE_MS;
}

export async function maybeRunCopilotCeo(): Promise<{ ran: boolean; proposals?: number; tickets?: number }> {
  if (!(await shouldRun())) return { ran: false };

  const repeatingCorrectionsRaw = await query<{
    domain: string;
    field_label: string;
    occurrence_count: number;
    ai_value: string | null;
    final_value: string | null;
  }>(
    `SELECT domain, field_label, COUNT(*)::int AS occurrence_count,
            (array_agg(ai_value ORDER BY created_at DESC))[1] AS ai_value,
            (array_agg(final_value ORDER BY created_at DESC))[1] AS final_value
     FROM copilot_fill_corrections
     WHERE was_corrected = true AND ai_reviewed = true AND escalated_to_ceo = true
       AND field_label IS NOT NULL
     GROUP BY domain, field_label
     HAVING COUNT(*) >= $1
     ORDER BY occurrence_count DESC
     LIMIT 20`,
    [MIN_OCCURRENCES]
  );

  const recurringUnresolvedRaw = await query<{
    domain: string;
    field_label: string;
    occurrence_count: number;
    candidate_id: string | null;
    application_id: string | null;
  }>(
    `SELECT domain, field_label, COUNT(*)::int AS occurrence_count,
            (array_agg(candidate_id ORDER BY created_at DESC))[1] AS candidate_id,
            (array_agg(application_id ORDER BY created_at DESC))[1] AS application_id
     FROM copilot_fill_corrections
     WHERE field_type = 'ai_answer' AND field_label IS NOT NULL
     GROUP BY domain, field_label
     HAVING COUNT(*) >= $1
     ORDER BY occurrence_count DESC
     LIMIT 20`,
    [MIN_OCCURRENCES]
  );

  if (repeatingCorrectionsRaw.length === 0 && recurringUnresolvedRaw.length === 0) {
    return { ran: true, proposals: 0, tickets: 0 };
  }

  const config = AGENT_CONFIG_DEFAULTS.copilot_ceo;
  const { result } = await callWithUsageTracking("copilot_ceo", undefined, async (provider) => {
    return runCopilotCeo(
      { temperature: config.temperature, max_output_tokens: config.maxOutputTokens, timeout_ms: config.timeoutMs },
      provider,
      {
        repeatingCorrectionPatterns: repeatingCorrectionsRaw.map((r) => ({
          domain: r.domain,
          fieldLabel: r.field_label,
          examples: [{ aiValue: r.ai_value, finalValue: r.final_value }],
          occurrenceCount: r.occurrence_count,
        })),
        recurringUnresolvedFields: recurringUnresolvedRaw.map((r) => ({
          domain: r.domain,
          fieldLabel: r.field_label,
          occurrenceCount: r.occurrence_count,
        })),
      }
    );
  });

  for (const p of result.proposals) {
    await createProposal({
      targetAutomationId: p.targetAutomationId,
      proposedChanges: p.systemPrompt ? { system_prompt: p.systemPrompt } : {},
      rationale: p.rationale,
      createdBy: "copilot_ceo",
    });
  }

  // action_items.candidate_id is NOT NULL — CEO's tickets are about a
  // pattern, not one specific person, so attach the most recent occurrence's
  // candidate as a representative example rather than skip the constraint.
  const fallbackRepresentative = recurringUnresolvedRaw[0];
  for (const t of result.tickets) {
    if (!fallbackRepresentative?.candidate_id) {
      console.warn("[copilotCeoService] Skipping ticket — no candidate to attach:", t.title);
      continue;
    }
    await execute(
      `INSERT INTO action_items (candidate_id, application_id, type, title, description, suggested_action, priority, metadata)
       VALUES ($1, $2, 'copilot_question', $3, $4, $5, $6, $7)`,
      [
        fallbackRepresentative.candidate_id,
        fallbackRepresentative.application_id,
        t.title,
        t.description,
        t.suggestedAction ?? null,
        t.priority,
        JSON.stringify({ source: "copilot_ceo" }),
      ]
    );
  }

  return { ran: true, proposals: result.proposals.length, tickets: result.tickets.length };
}
