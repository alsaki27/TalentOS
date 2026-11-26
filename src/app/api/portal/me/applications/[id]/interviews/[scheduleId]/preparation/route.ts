import { NextResponse } from "next/server";
import { requireCurrentCandidate } from "@/server/auth/candidateAuth";
import { UUID_PATTERN, uploadInterviewPreparation } from "@/server/services/interviewPreparationFiles";

export async function POST(request: Request, { params }: { params: { id: string; scheduleId: string } }) {
  const { context, response } = await requireCurrentCandidate();
  if (response) return response;
  if (![params.id, params.scheduleId].every((id) => UUID_PATTERN.test(id))) {
    return NextResponse.json({ error: "Interview stage not found." }, { status: 404 });
  }
  return uploadInterviewPreparation(request, params.id, params.scheduleId, {
    user_id: null,
    email: context.candidate.account_email || context.candidate.email,
    display_name: context.candidate.name,
  }, context.candidateId);
}

export const PUT = POST;
