import { AiRouteCallError } from "@/lib/ai/routing";
import { sha256Hex } from "@/lib/sha256";
import { execute, queryOne } from "@/server/db/neon";
import type { EvidenceStage } from "@/lib/ai/application-agents/evidencePipeline";

export class ResumeModelCheckpointError extends Error {}

export async function withResumeModelCheckpoint<T>(input: {
  workflowId: string; identity: unknown; task: NonNullable<EvidenceStage["task"]>;
}, run: () => Promise<T>): Promise<{ result: T; reused: boolean }> {
  const hash = await sha256Hex(JSON.stringify([input.identity, input.task]));
  const reservation = await queryOne<{ input_hash: string }>(
    `INSERT INTO application_resume_model_checkpoints (input_hash, workflow_id, status)
       VALUES ($1, $2, 'reserved') ON CONFLICT (input_hash) DO NOTHING RETURNING input_hash`,
    [hash, input.workflowId],
  );
  if (!reservation) {
    const existing = await queryOne<{ result: T; status: string }>(
      "SELECT result, status FROM application_resume_model_checkpoints WHERE input_hash = $1 FOR SHARE",
      [hash],
    );
    if (existing?.status === "completed") return { result: existing.result, reused: true };
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
    const rejectedBeforeGeneration = error instanceof AiRouteCallError &&
      ["rate_limit", "quota_exhausted", "billing_error", "model_unavailable", "auth_error", "configuration_error"].includes(error.errorCode ?? "");
    await (rejectedBeforeGeneration
      ? execute("DELETE FROM application_resume_model_checkpoints WHERE input_hash = $1 AND status = 'reserved'", [hash])
      : execute("UPDATE application_resume_model_checkpoints SET status = 'uncertain', updated_at = NOW() WHERE input_hash = $1 AND status = 'reserved'", [hash])
    ).catch(() => undefined);
    if (rejectedBeforeGeneration) throw error;
    throw new ResumeModelCheckpointError("Luna did not return a confirmed draft. Its request was saved for investigation to avoid an automatic repeat.");
  }
}
