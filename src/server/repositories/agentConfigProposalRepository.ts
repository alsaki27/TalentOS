import { query, queryOne, execute } from "@/server/db/neon";

export interface AgentConfigProposalRow {
  id: string;
  target_automation_id: string;
  proposed_changes: unknown;
  rationale: string | null;
  status: "pending" | "approved" | "rejected" | "superseded";
  created_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export async function createProposal(input: {
  targetAutomationId: string;
  proposedChanges: Record<string, unknown>;
  rationale?: string;
  createdBy?: string;
}): Promise<AgentConfigProposalRow> {
  var rows = await query<AgentConfigProposalRow>(
    `INSERT INTO agent_config_proposals (target_automation_id, proposed_changes, rationale, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [
      input.targetAutomationId,
      JSON.stringify(input.proposedChanges),
      input.rationale ?? null,
      input.createdBy ?? "job_ceo",
    ]
  );
  return rows[0];
}

export async function listProposals(status?: string): Promise<AgentConfigProposalRow[]> {
  if (status) {
    return query<AgentConfigProposalRow>(
      "SELECT * FROM agent_config_proposals WHERE status = $1 ORDER BY created_at DESC",
      [status]
    );
  }
  return query<AgentConfigProposalRow>(
    "SELECT * FROM agent_config_proposals ORDER BY created_at DESC"
  );
}

export async function findProposalById(id: string): Promise<AgentConfigProposalRow | null> {
  return queryOne<AgentConfigProposalRow>(
    "SELECT * FROM agent_config_proposals WHERE id = $1",
    [id]
  );
}

export async function setProposalStatus(
  id: string,
  status: "approved" | "rejected",
  reviewedBy?: string
): Promise<void> {
  await execute(
    `UPDATE agent_config_proposals
     SET status = $1, reviewed_by = $2, reviewed_at = NOW()
     WHERE id = $3`,
    [status, reviewedBy ?? null, id]
  );
}

export async function supersedePendingFor(targetAutomationId: string): Promise<void> {
  await execute(
    `UPDATE agent_config_proposals
     SET status = 'superseded'
     WHERE target_automation_id = $1 AND status = 'pending'`,
    [targetAutomationId]
  );
}
