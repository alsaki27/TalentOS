import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { execute, queryOne } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const draft = await queryOne<Record<string, any>>(
    `SELECT id, status FROM candidate_messages WHERE id = $1`,
    [params.id]
  );

  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  if (draft.status !== "pending_approval") {
    return NextResponse.json(
      { error: "Draft is not pending approval" },
      { status: 400 }
    );
  }

  await execute(
    `UPDATE candidate_messages
     SET status = 'rejected', approved_by = $2, approved_at = now()
     WHERE id = $1`,
    [params.id, context.profile.user_id]
  );

  return NextResponse.json({ rejected: true });
}
