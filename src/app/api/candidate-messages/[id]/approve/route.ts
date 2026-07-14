import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { execute, queryOne } from "@/server/db/neon";
import { sendApprovedDraft } from "@/server/services/gmailSendService";

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
     SET status = 'approved', approved_by = $2, approved_at = now()
     WHERE id = $1`,
    [params.id, context.profile.user_id]
  );

  try {
    const result = await sendApprovedDraft(params.id);

    if (result.needsReconnect) {
      return NextResponse.json(
        {
          sent: false,
          needsReconnect: true,
          email: result.email,
          error: result.error,
        },
        { status: 409 }
      );
    }

    if (!result.sent) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }

    return NextResponse.json({
      sent: true,
      gmailMessageId: result.gmailMessageId,
      threadId: result.gmailThreadId,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: `Send failed: ${err.message}` },
      { status: 502 }
    );
  }
}
