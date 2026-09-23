import { NextResponse } from "next/server";
import { ALL_USER_ROLES, requireCurrentUser } from "@/lib/auth";
import { approveCandidateJobMatch } from "@/server/services/candidateJobMatcherService";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(ALL_USER_ROLES);
  if (response) return response;
  const body = await request.json().catch(() => ({})) as { note?: unknown; assignedToUserId?: unknown };
  try {
    const result = await approveCandidateJobMatch({
      decisionId: params.id,
      actorUserId: context!.profile.user_id,
      actorName: context!.profile.display_name || context!.profile.email || "TalentOS user",
      note: typeof body.note === "string" ? body.note.slice(0, 1000) : null,
      assignedToUserId: typeof body.assignedToUserId === "string" ? body.assignedToUserId : null,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: /not found/i.test(message) ? 404 : 409 });
  }
}
