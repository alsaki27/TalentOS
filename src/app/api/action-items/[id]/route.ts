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
    await execute(
      "UPDATE action_items SET status = $1, resolved_at = now(), resolved_by_user_id = $2 WHERE id = $3",
      [status, context.profile.user_id, params.id]
    );
  } else {
    await execute(
      "UPDATE action_items SET status = $1, resolved_at = NULL, resolved_by_user_id = NULL WHERE id = $2",
      [status, params.id]
    );
  }

  return NextResponse.json({ ok: true });
}
