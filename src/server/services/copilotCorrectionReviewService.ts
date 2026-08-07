// src/server/services/copilotCorrectionReviewService.ts
// Runs Copilot Correction Reviewer on a single just-recorded correction,
// async and non-blocking (dispatched via backgroundDispatch from
// record-outcome). Never on the AE's critical path.

import { queryOne } from "@/server/db/neon";
import { callWithUsageTracking } from "@/lib/ai/routing";
import { runCopilotCorrectionReviewer } from "@/lib/ai/application-agents/copilotCorrectionReviewer";
import { AGENT_CONFIG_DEFAULTS } from "@/lib/ai/application-agents/constants";
import { findAgentConfigByAutomationId } from "@/server/repositories/aiAgentConfigRepository";
import { applyCorrectionReview } from "@/server/repositories/copilotLearningRepository";

export async function reviewCorrectionAsync(correctionId: string): Promise<void> {
  try {
    const row = await queryOne<{ domain: string; field_label: string | null; ai_value: string | null; final_value: string | null }>(
      `SELECT domain, field_label, ai_value, final_value FROM copilot_fill_corrections WHERE id = $1`,
      [correctionId]
    );
    if (!row) return;

    const agentConfig = await findAgentConfigByAutomationId("copilot_correction_reviewer");
    const defaults = AGENT_CONFIG_DEFAULTS.copilot_correction_reviewer;
    const options = {
      system_prompt: agentConfig?.system_prompt ?? undefined,
      temperature: agentConfig?.temperature ?? defaults.temperature,
      max_output_tokens: agentConfig?.max_output_tokens ?? defaults.maxOutputTokens,
      timeout_ms: agentConfig?.timeout_ms ?? defaults.timeoutMs,
    };

    const { result } = await callWithUsageTracking("copilot_correction_reviewer", undefined, async (provider) =>
      runCopilotCorrectionReviewer(options, provider, {
        domain: row.domain,
        fieldLabel: row.field_label,
        aiValue: row.ai_value,
        finalValue: row.final_value,
      })
    );

    await applyCorrectionReview(correctionId, result);
  } catch (err) {
    console.error("[copilotCorrectionReviewService] Failed to review correction", correctionId, err);
  }
}
