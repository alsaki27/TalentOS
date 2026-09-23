import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { findProposalById, setProposalStatus } from "@/server/repositories/agentConfigProposalRepository";
import { queryOne, execute } from "@/server/db/neon";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

const ALLOWED_CONFIG_FIELDS = [
  "display_name",
  "system_prompt",
  "prompt_version",
  "output_schema_version",
  "temperature",
  "max_output_tokens",
  "timeout_ms",
  "max_attempts",
  "approval_policy",
  "minimum_score",
  "is_active",
];

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const proposal = await findProposalById(params.id);
  if (!proposal) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }

  if (proposal.status !== "pending") {
    return NextResponse.json({ error: `Proposal is already ${proposal.status}` }, { status: 400 });
  }

  const changes = (proposal.proposed_changes ?? {}) as Record<string, unknown>;
  const targetId = proposal.target_automation_id;

  const existing = await queryOne<any>(
    "SELECT automation_id FROM ai_agent_configs WHERE automation_id = $1",
    [targetId]
  );

  const userId = context?.profile.user_id;

  if (existing) {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const field of ALLOWED_CONFIG_FIELDS) {
      if (changes[field] !== undefined) {
        fields.push(`${field} = $${idx++}`);
        values.push(changes[field]);
      }
    }

    if (fields.length === 0) {
      return NextResponse.json({ error: "No valid config fields in proposal" }, { status: 400 });
    }

    fields.push(`updated_by = $${idx++}`);
    values.push(userId);
    fields.push(`updated_at = NOW()`);
    values.push(targetId);

    await execute(
      `UPDATE ai_agent_configs SET ${fields.join(", ")} WHERE automation_id = $${idx}`,
      values
    );
  } else {
    const cols: string[] = ["automation_id", "updated_by", "updated_at"];
    const placeholders: string[] = ["$1", "$2", "NOW()"];
    const vals: unknown[] = [targetId, userId];
    let pIdx = 3;

    const autom = await queryOne<any>(
      "SELECT label FROM ai_automations WHERE id = $1",
      [targetId]
    );

    if (changes.display_name !== undefined) {
      cols.push("display_name"); placeholders.push(`$${pIdx++}`); vals.push(changes.display_name);
    } else {
      cols.push("display_name"); placeholders.push(`$${pIdx++}`); vals.push(autom?.label ?? targetId);
    }

    for (const field of ALLOWED_CONFIG_FIELDS) {
      if (field === "display_name") continue;
      if (changes[field] !== undefined) {
        cols.push(field); placeholders.push(`$${pIdx++}`); vals.push(changes[field]);
      }
    }

    await execute(
      `INSERT INTO ai_agent_configs (${cols.join(", ")}) VALUES (${placeholders.join(", ")})`,
      vals
    );
  }

  await setProposalStatus(params.id, "approved", userId);

  await logActivity({
    type: "job_ceo_proposal_approved",
    description: `Proposal approved: ${targetId} config updated (${Object.keys(changes).join(", ")})`,
    entityType: "agent_config_proposal",
    entityId: params.id,
    userId: userId,
  });

  const updated = await queryOne<any>(
    "SELECT * FROM ai_agent_configs WHERE automation_id = $1",
    [targetId]
  );

  return NextResponse.json({ config: updated });
}
