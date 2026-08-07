import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { execute } from "@/server/db/neon";

const VALID_STATUSES = new Set(["open", "in_progress", "done", "dismissed"]);

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const body = await req.json();
  const status = String(body.status ?? "");
  if (!VALID_STATUSES.has(status)) {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }

  const resolved = status === "done" || status === "dismissed";
  if (resolved) {
    const note = typeof body.resolution_note === "string" ? body.resolution_note.trim().slice(0, 4000) : null;
    const resolutionKind = status === "dismissed" ? "dismissed" : (body.takeover ? "manual_takeover" : "manual_resolution");
    await execute(
      "UPDATE action_items SET status = $1, resolved_at = now(), resolved_by_user_id = $2, resolution_note = COALESCE($3, resolution_note), resolution_kind = $4 WHERE id = $5",
      [status, context.profile.user_id, note, resolutionKind, params.id]
    );
  } else if (status === "in_progress") {
    await execute(
      "UPDATE action_items SET status = $1, taken_over_at = COALESCE(taken_over_at, now()), taken_over_by_user_id = $2, resolution_note = COALESCE($3, resolution_note) WHERE id = $4",
      [status, context.profile.user_id, typeof body.resolution_note === "string" ? body.resolution_note.trim().slice(0, 4000) : null, params.id]
    );
  } else {
    await execute(
      "UPDATE action_items SET status = $1, resolved_at = NULL, resolved_by_user_id = NULL WHERE id = $2",
      [status, params.id]
    );
  }

  return NextResponse.json({ ok: true });
}
