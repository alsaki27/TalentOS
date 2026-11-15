import { NextResponse } from "next/server";
import { ALL_USER_ROLES, requireCurrentUser } from "@/lib/auth";
import { UUID_PATTERN, uploadInterviewPreparation } from "@/server/services/interviewPreparationFiles";

export async function POST(request: Request, { params }: { params: { id: string; scheduleId: string } }) {
  const { context, response } = await requireCurrentUser(ALL_USER_ROLES);
  if (response) return response;
  if (![params.id, params.scheduleId].every((id) => UUID_PATTERN.test(id))) {
    return NextResponse.json({ error: "Interview stage not found." }, { status: 404 });
  }
  return uploadInterviewPreparation(request, params.id, params.scheduleId, context.profile);
}
