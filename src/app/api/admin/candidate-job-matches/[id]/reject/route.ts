import { NextResponse } from "next/server";
import { ALL_USER_ROLES, requireCurrentUser } from "@/lib/auth";
import { rejectCandidateJobMatch } from "@/server/services/candidateJobMatcherService";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(ALL_USER_ROLES);
  if (response) return response;
  const body = await request.json().catch(() => ({})) as { note?: unknown };
  try {
    const decision = await rejectCandidateJobMatch({
      decisionId: params.id, actorUserId: context!.profile.user_id,
      note: typeof body.note === "string" ? body.note.slice(0, 1000) : null,
    });
    return NextResponse.json({ ok: true, decision });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}
