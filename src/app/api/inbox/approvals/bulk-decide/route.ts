// src/app/api/inbox/approvals/bulk-decide/route.ts
// POST -> approve or reject up to 50 proposals in one request. Loops
// decideApproval() sequentially, not Promise.all - the Neon HTTP driver
// plus per-request Worker CPU budget makes fan-out a bad idea here, and
// each decision is already a handful of round trips on its own.

import { NextRequest, NextResponse } from "next/server";
import { ALL_USER_ROLES, requireCurrentUser } from "@/lib/auth";
import { decideApproval } from "@/server/services/emailApprovalDecisionService";

export const dynamic = "force-dynamic";

const MAX_IDS = 50;

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(ALL_USER_ROLES);
  if (response) return response;

  const body = await req.json().catch(() => ({}));
  const decision = body.decision;
  const ids: unknown = body.ids;
  const note: string | null = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 4000) : null;

  if (decision !== "approved" && decision !== "rejected") {
    return NextResponse.json({ error: "decision must be 'approved' or 'rejected'." }, { status: 400 });
  }
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === "string")) {
    return NextResponse.json({ error: "ids must be a non-empty array of strings." }, { status: 400 });
  }
  if (ids.length > MAX_IDS) {
    return NextResponse.json({ error: `At most ${MAX_IDS} ids per request.` }, { status: 400 });
  }

  const actorName = context!.profile.display_name || context!.profile.email || "An AE";
  const actorUserId = context!.profile.user_id;

  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const id of ids) {
    const outcome = await decideApproval({ itemId: id, decision, note, actorName, actorUserId });
    results.push({ id, ok: outcome.ok, error: outcome.ok ? undefined : outcome.body.error });
  }

  return NextResponse.json({ results });
}
