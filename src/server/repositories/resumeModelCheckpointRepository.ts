import { AiAttemptCheckpointError, AiRouteCallError, classifyAiErrorCode } from "@/lib/ai/routing";
import { sha256Hex } from "@/lib/sha256";
import { execute, queryOne } from "@/server/db/neon";
import type { EvidenceStage } from "@/lib/ai/application-agents/evidencePipeline";
import { evidenceRouteId } from "@/lib/ai/application-agents/workflowStages";

export class ResumeModelCheckpointError extends AiAttemptCheckpointError {}

type DraftInput = { identity: unknown; task: NonNullable<EvidenceStage["task"]> };

function draftHash(input: DraftInput) {
  return sha256Hex(JSON.stringify([input.identity, input.task]));
}

export async function findCompletedResumeModelCheckpoint<T>(input: DraftInput): Promise<T | null> {
  const row = await queryOne<{ result: T }>(
    "SELECT result FROM application_resume_model_checkpoints WHERE input_hash = $1 AND status = 'completed'",
    [await draftHash(input)],
  );
  return row?.result ?? null;
}

export async function withResumeModelCheckpoint<T>(
  input: DraftInput & { workflowId: string }, run: () => Promise<T>,
  recoverSelection?: { model: string; result: () => T },
): Promise<{ result: T; reused: boolean }> {
  const hash = await draftHash(input);
  const reservation = await queryOne<{ input_hash: string }>(
    `INSERT INTO application_resume_model_checkpoints (input_hash, workflow_id, status)
       VALUES ($1, $2, 'reserved') ON CONFLICT (input_hash) DO NOTHING RETURNING input_hash`,
    [hash, input.workflowId],
  );
  if (!reservation) {
    const existing = await queryOne<{ result: T; status: string; workflow_id: string; updated_at: string }>(
      "SELECT result, status, workflow_id, updated_at::text FROM application_resume_model_checkpoints WHERE input_hash = $1 FOR SHARE",
      [hash],
    );
    if (existing?.status === "completed") return { result: existing.result, reused: true };
    if (existing?.status === "uncertain" && recoverSelection) {
      // Only recover a recorded reply rejected by the old evidence selector.
      // A timeout or missing provider result remains protected from replay.
      const confirmed = await queryOne<{ confirmed: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM ai_usage_events WHERE workflow_id = $1
             AND automation_id = $2 AND provider = 'openai' AND model = $3
             AND outcome = 'failure' AND output_tokens > 0 AND error_code = 'invalid_output'
             AND error_message = 'Invalid model output: selection includes unknown evidence'
             AND created_at BETWEEN $4::timestamptz AND $4::timestamptz + INTERVAL '1 minute'
         ) AS confirmed`,
        [existing.workflow_id, evidenceRouteId("application_resume_forge"), recoverSelection.model, existing.updated_at],
      );
      if (confirmed?.confirmed) {
        const result = recoverSelection.result();
        const recovered = await queryOne<{ result: T }>(
          `UPDATE application_resume_model_checkpoints SET status = 'completed', result = $2::jsonb, updated_at = NOW()
             WHERE input_hash = $1 AND status = 'uncertain' RETURNING result`,
          [hash, JSON.stringify(result)],
        );
        const saved = recovered ?? await queryOne<{ result: T }>(
          "SELECT result FROM application_resume_model_checkpoints WHERE input_hash = $1 AND status = 'completed'", [hash],
        );
        if (saved) return { result: saved.result, reused: true };
      }
    }
    throw new ResumeModelCheckpointError("An earlier Luna request for these inputs has no confirmed result. Check its usage before requesting another draft.");
  }
  try {
    const result = await run();
    await execute(
      `UPDATE application_resume_model_checkpoints SET status = 'completed', result = $2::jsonb, updated_at = NOW()
         WHERE input_hash = $1 AND status = 'reserved'`,
      [hash, JSON.stringify(result)],
    );
    return { result, reused: false };
  } catch (error) {
    const code = error instanceof AiRouteCallError ? error.errorCode : classifyAiErrorCode(error);
    const rejectedBeforeGeneration =
      ["rate_limit", "quota_exhausted", "billing_error", "model_unavailable", "auth_error", "configuration_error"].includes(code ?? "");
    await (rejectedBeforeGeneration
      ? execute("DELETE FROM application_resume_model_checkpoints WHERE input_hash = $1 AND status = 'reserved'", [hash])
      : execute("UPDATE application_resume_model_checkpoints SET status = 'uncertain', updated_at = NOW() WHERE input_hash = $1 AND status = 'reserved'", [hash])
    ).catch(() => undefined);
    if (rejectedBeforeGeneration) throw error;
    throw new ResumeModelCheckpointError("Luna did not return a confirmed draft. Its request was saved for investigation to avoid an automatic repeat.", { cause: error });
  }
}
