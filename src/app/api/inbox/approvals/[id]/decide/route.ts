// src/app/api/inbox/approvals/[id]/decide/route.ts
// POST -> approve or reject a status_change_approval proposal.
//
// Deliberately NOT routed through PATCH /api/action-items/[id]: that route
// 400s unless a resolution_note accompanies closing an email-linked task as
// done, so a bare Approve click would fail there. decideApproval() owns the
// two-step approve sequence PATCH was never built for (write the status,
// THEN mark the item decided).

import { NextRequest, NextResponse } from "next/server";
import { ALL_USER_ROLES, requireCurrentUser } from "@/lib/auth";
import { decideApproval } from "@/server/services/emailApprovalDecisionService";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(ALL_USER_ROLES);
  if (response) return response;

  const body = await req.json().catch(() => ({}));
  const decision = body.decision;
  const note: string | null = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 4000) : null;
  if (decision !== "approved" && decision !== "rejected") {
    return NextResponse.json({ error: "decision must be 'approved' or 'rejected'." }, { status: 400 });
  }

  const outcome = await decideApproval({
    itemId: params.id,
    decision,
    note,
    actorName: context!.profile.display_name || context!.profile.email || "An AE",
    actorUserId: context!.profile.user_id,
  });

  return NextResponse.json(outcome.body, { status: outcome.httpStatus });
}
