// src/server/services/applicationStatusService.ts
// Canonical writer for applications.status changes.
//
// Before this existed, every caller inlined its own SQL with inconsistent
// audit writes - e.g. src/app/api/bulk/route.ts skips application_stage_history
// entirely. This is Chunk B of the email-intelligence plan, converting
// exactly the 2 call sites that need it: the email-triage auto-write path
// (this chunk) and the approval-decide route (a later chunk, once it
// exists). The other call sites are deliberately left alone - each updates
// several other columns in the same UPDATE statement, and converting them
// risks the queue and the browser extension:
//   - src/app/api/applications/[id]/route.ts (canonical UI PATCH)
//   - src/app/api/bulk/route.ts (also missing application_stage_history
//     entirely - a pre-existing defect, tracked but not fixed here)
//   - src/app/api/applications/route.ts (create)
//   - advanceAeStageAfterAiCompletion (applicationsRepository.ts)
//   - src/lib/ai/application-agents/finalizationService.ts
//   - src/app/api/extension/v1/copilot/application-status/route.ts
//   - src/server/services/candidateJobMatcherService.ts (create)

import { execute, queryOne } from "@/server/db/neon";
import { logActivity } from "@/lib/activity";

export type EmailStageTarget = "applied" | "interview" | "offer" | "rejected";

// Moved verbatim from gmailSyncService.ts's applyEmailStageDecision - these
// never-downgrade rules are correct and must be preserved as-is. Moving them
// here also makes them unit-testable without dragging in the Gmail API and
// AI provider.
export function emailStageTarget(category: string): EmailStageTarget | null {
  if (category === "application_confirmation") return "applied";
  if (category === "interview_invite" || category === "scheduling") return "interview";
  if (category === "offer") return "offer";
  if (category === "rejection") return "rejected";
  return null;
}

export function shouldAcceptEmailStage(currentStatus: string, target: EmailStageTarget): boolean {
  if (currentStatus === target) return false;
  if (currentStatus === "withdrawn") return false;
  if (currentStatus === "offer" && target !== "offer") return false;
  if (currentStatus === "rejected" && target !== "rejected") return false;
  if (target === "rejected") return currentStatus !== "offer";
  if (target === "interview") return !["offer", "rejected", "withdrawn"].includes(currentStatus);
  if (target === "applied") return !["interview", "offer", "rejected", "withdrawn"].includes(currentStatus);
  return true;
}

const KNOWN_STAGE_TARGETS = new Set<string>(["applied", "interview", "offer", "rejected"]);

export type StatusActorType = "ai" | "ae" | "system";
export type StatusSource = "queue" | "email_ai" | "email_approval" | "ai_pipeline" | "extension" | "migration";

export interface ApplicationStatusChangeInput {
  applicationId: string;
  toStatus: string;
  actorType: StatusActorType;
  actorName: string;
  actorUserId?: string | null;
  source: StatusSource;
  reason?: string | null;
  emailCommunicationId?: string | null;
  actionItemId?: string | null;
  confidence?: number | null;
  /** Enforce shouldAcceptEmailStage's never-downgrade rules. Default true. */
  enforceEmailStageGuard?: boolean;
}

export type StatusChangeSkipReason = "not_found" | "same_status" | "guard_rejected" | "concurrent_update";

export interface ApplicationStatusChangeResult {
  changed: boolean;
  fromStatus: string | null;
  toStatus: string;
  skippedReason?: StatusChangeSkipReason;
}

export async function changeApplicationStatus(
  input: ApplicationStatusChangeInput,
): Promise<ApplicationStatusChangeResult> {
  const enforceGuard = input.enforceEmailStageGuard !== false;

  const current = await queryOne<{
    status: string;
    ae_stage: string | null;
    application_stage: string | null;
    applied_at: string | null;
    candidate_id: string;
  }>(
    "SELECT status, ae_stage, application_stage, applied_at, candidate_id FROM applications WHERE id = $1",
    [input.applicationId],
  );
  if (!current) {
    return { changed: false, fromStatus: null, toStatus: input.toStatus, skippedReason: "not_found" };
  }
  if (current.status === input.toStatus) {
    return { changed: false, fromStatus: current.status, toStatus: input.toStatus, skippedReason: "same_status" };
  }
  if (enforceGuard && KNOWN_STAGE_TARGETS.has(input.toStatus)) {
    if (!shouldAcceptEmailStage(current.status, input.toStatus as EmailStageTarget)) {
      return { changed: false, fromStatus: current.status, toStatus: input.toStatus, skippedReason: "guard_rejected" };
    }
  }

  const now = new Date().toISOString();

  // The `AND status = $expected` predicate is the optimistic-concurrency
  // substitute: the Neon HTTP driver has no transactions (src/server/db/neon.ts
  // exports only query/queryOne/execute, one statement per round trip), so
  // this is the only available way to detect a race against a concurrent
  // writer. If rowCount is 0, the status changed between the SELECT above
  // and this UPDATE - write no audit rows at all rather than recording a
  // change that didn't actually happen. Strictly safer than the original
  // applyEmailStageDecision, which wrote three sequential audit rows
  // regardless of whether the row it read was still current.
  const { rowCount } = await execute(
    `UPDATE applications
        SET status = $2,
            application_stage = $2,
            application_stage_changed_at = $3,
            application_stage_changed_by_user_id = $4,
            application_stage_changed_by_name = $5,
            applied_at = CASE WHEN $2 = 'applied' THEN COALESCE(applied_at, $3) ELSE applied_at END,
            updated_at = $3
      WHERE id = $1 AND status = $6`,
    [input.applicationId, input.toStatus, now, input.actorUserId ?? null, input.actorName, current.status],
  );
  if (rowCount === 0) {
    return { changed: false, fromStatus: current.status, toStatus: input.toStatus, skippedReason: "concurrent_update" };
  }

  const fromStage = current.application_stage || current.ae_stage || current.status;
  await execute(
    `INSERT INTO application_stage_history
       (application_id, from_stage, to_stage, changed_at, changed_by_user_id, changed_by_name, reason, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [input.applicationId, fromStage, input.toStatus, now, input.actorUserId ?? null, input.actorName, input.reason ?? null, input.source],
  );

  // This insert is the entire candidate-portal integration -
  // candidatePortalDashboardService.ts's timeline is built from this table.
  // Skip it and the portal silently goes stale.
  await execute(
    `INSERT INTO application_events (application_id, from_status, to_status, note)
     VALUES ($1, $2, $3, $4)`,
    [
      input.applicationId, current.status, input.toStatus,
      input.reason ?? `${input.actorName}: ${current.status} → ${input.toStatus}`,
    ],
  );

  await logActivity({
    actorName: input.actorName,
    actorType: input.actorType,
    type: "application_status_change",
    description: `${input.actorName} moved application from "${current.status}" to "${input.toStatus}"${input.reason ? `: ${input.reason}` : ""}`,
    entityType: "application",
    entityId: input.applicationId,
    metadata: { source: input.source, confidence: input.confidence ?? null },
  });

  if (input.emailCommunicationId || input.actionItemId) {
    await execute(
      `INSERT INTO candidate_workflow_events
         (candidate_id, application_id, action_item_id, email_communication_id, event_type, actor_type, payload)
       VALUES ($1, $2, $3, $4, 'application_status_changed', $5, $6)`,
      [
        current.candidate_id, input.applicationId, input.actionItemId ?? null, input.emailCommunicationId ?? null,
        input.actorType, JSON.stringify({ fromStatus: current.status, toStatus: input.toStatus, source: input.source }),
      ],
    );
  }

  return { changed: true, fromStatus: current.status, toStatus: input.toStatus };
}
