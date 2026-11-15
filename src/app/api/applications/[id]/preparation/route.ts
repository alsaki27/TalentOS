import { NextResponse } from "next/server";
import { ALL_USER_ROLES, requireCurrentUser } from "@/lib/auth";
import { UUID_PATTERN, uploadInterviewPreparation } from "@/server/services/interviewPreparationFiles";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(ALL_USER_ROLES);
  if (response) return response;
  if (!UUID_PATTERN.test(params.id)) return NextResponse.json({ error: "Application not found." }, { status: 404 });
  return uploadInterviewPreparation(request, params.id, null, context.profile);
}
