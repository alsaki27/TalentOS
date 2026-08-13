// src/server/services/emailApprovalDecisionService.ts
// Shared core for POST /api/inbox/approvals/[id]/decide and
// POST /api/inbox/approvals/bulk-decide - extracted so the bulk route can
// loop the exact same approve/reject logic instead of duplicating it.

import { queryOne, execute } from "@/server/db/neon";
import { changeApplicationStatus } from "@/server/services/applicationStatusService";

export interface DecideApprovalInput {
  itemId: string;
  decision: "approved" | "rejected";
  note: string | null;
  actorName: string;
  actorUserId: string;
}

export type DecideApprovalOutcome =
  | { ok: true; httpStatus: 200; body: { ok: true; decision: "rejected" } }
  | { ok: true; httpStatus: 200; body: { ok: true; decision: "approved"; applicationId: string; fromStatus: string | null; toStatus: string } }
  | { ok: false; httpStatus: 404; body: { error: string } }
  | { ok: false; httpStatus: 409; body: { error: string; decision?: string; skippedReason?: string; currentStatus?: string | null } }
  | { ok: false; httpStatus: 400; body: { error: string } };

interface ProposalRow {
  id: string;
  candidate_id: string;
  application_id: string | null;
  email_communication_id: string | null;
  title: string;
  proposed_status: string | null;
  ai_confidence: number | null;
  decision: string | null;
  status: string;
}

export async function decideApproval(input: DecideApprovalInput): Promise<DecideApprovalOutcome> {
  const item = await queryOne<ProposalRow>(
    `SELECT id, candidate_id, application_id, email_communication_id, title, proposed_status, ai_confidence, decision, status
       FROM action_items WHERE id = $1 AND type = 'status_change_approval'`,
    [input.itemId],
  );
  if (!item) return { ok: false, httpStatus: 404, body: { error: "Approval not found." } };

  // Idempotency: a proposal can only be decided once.
  if (item.decision) {
    return { ok: false, httpStatus: 409, body: { error: "Already decided.", decision: item.decision } };
  }

  const now = new Date().toISOString();

  if (input.decision === "rejected") {
    await execute(
      `UPDATE action_items
          SET status = 'dismissed', decision = 'rejected', decided_at = $2, decided_by_user_id = $3,
              decision_note = $4, resolution_kind = 'dismissed', resolution_note = $4,
              resolved_at = $2, resolved_by_user_id = $3
        WHERE id = $1`,
      [item.id, now, input.actorUserId, input.note],
    );
    await execute(
      `INSERT INTO candidate_workflow_events
         (candidate_id, application_id, action_item_id, email_communication_id, event_type, actor_type, actor_user_id, payload)
       VALUES ($1, $2, $3, $4, 'status_change_rejected', 'ae', $5, $6)`,
      [item.candidate_id, item.application_id, item.id, item.email_communication_id, input.actorUserId, JSON.stringify({ note: input.note })],
    );
    return { ok: true, httpStatus: 200, body: { ok: true, decision: "rejected" } };
  }

  // approved
  if (!item.application_id || !item.proposed_status) {
    return { ok: false, httpStatus: 400, body: { error: "This proposal has no application or proposed status to apply." } };
  }

  // Order is load-bearing: write the application status FIRST, mark the
  // item decided SECOND. Re-approving after a partial failure is safe -
  // changeApplicationStatus returns same_status and no-ops - but the
  // reverse order would lose the status change silently.
  const result = await changeApplicationStatus({
    applicationId: item.application_id,
    toStatus: item.proposed_status,
    actorType: "ae",
    actorName: input.actorName,
    actorUserId: input.actorUserId,
    source: "email_approval",
    reason: input.note ?? item.title,
    emailCommunicationId: item.email_communication_id,
    actionItemId: item.id,
    confidence: item.ai_confidence,
  });

  if (!result.changed) {
    // The application moved (or was already at the target) since this
    // proposal was created - superseded, not a real approval. Close the
    // item out of the queue rather than leaving a stale proposal open.
    await execute(
      `UPDATE action_items
          SET status = 'dismissed', decision = 'rejected', decided_at = $2, decided_by_user_id = $3,
              decision_note = $4, resolution_kind = 'dismissed', resolution_note = $4,
              resolved_at = $2, resolved_by_user_id = $3
        WHERE id = $1`,
      [item.id, now, input.actorUserId, `Superseded: application already at "${result.fromStatus}".`],
    );
    return {
      ok: false, httpStatus: 409,
      body: { error: "Superseded: the application already moved.", skippedReason: result.skippedReason, currentStatus: result.fromStatus },
    };
  }

  await execute(
    `UPDATE action_items
        SET status = 'done', decision = 'approved', decided_at = $2, decided_by_user_id = $3,
            decision_note = $4, resolution_kind = 'manual_resolution',
            resolved_at = $2, resolved_by_user_id = $3
      WHERE id = $1`,
    [item.id, now, input.actorUserId, input.note],
  );
  await execute(
    `INSERT INTO candidate_workflow_events
       (candidate_id, application_id, action_item_id, email_communication_id, event_type, actor_type, actor_user_id, payload)
     VALUES ($1, $2, $3, $4, 'status_change_approved', 'ae', $5, $6)`,
    [item.candidate_id, item.application_id, item.id, item.email_communication_id, input.actorUserId, JSON.stringify({ from: result.fromStatus, to: result.toStatus })],
  );

  return {
    ok: true, httpStatus: 200,
    body: { ok: true, decision: "approved", applicationId: item.application_id, fromStatus: result.fromStatus, toStatus: result.toStatus },
  };
}
