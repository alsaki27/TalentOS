import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { findProposalById, setProposalStatus } from "@/server/repositories/agentConfigProposalRepository";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
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

  const userId = context?.profile.user_id;
  await setProposalStatus(params.id, "rejected", userId);

  await logActivity({
    type: "job_ceo_proposal_rejected",
    description: `Proposal rejected: ${proposal.target_automation_id}`,
    entityType: "agent_config_proposal",
    entityId: params.id,
    userId: userId,
  });

  return NextResponse.json({ status: "rejected" });
}
