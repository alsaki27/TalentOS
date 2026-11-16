import { NextResponse } from "next/server";
import { requireCurrentCandidate } from "@/server/auth/candidateAuth";
import { UUID_PATTERN, downloadInterviewPreparation, updateInterviewPreparation } from "@/server/services/interviewPreparationFiles";

export async function GET(request: Request, { params }: { params: { id: string; scheduleId: string; fileId: string } }) {
  const { context, response } = await requireCurrentCandidate();
  if (response) return response;
  if (![params.id, params.scheduleId, params.fileId].every((id) => UUID_PATTERN.test(id))) {
    return NextResponse.json({ error: "Preparation file not found." }, { status: 404 });
  }
  return downloadInterviewPreparation(request, params.id, params.scheduleId, params.fileId, context.candidateId);
}

export async function DELETE(_request: Request, { params }: { params: { id: string; scheduleId: string; fileId: string } }) {
  const { context, response } = await requireCurrentCandidate();
  if (response) return response;
  if (![params.id, params.scheduleId, params.fileId].every((id) => UUID_PATTERN.test(id))) {
    return NextResponse.json({ error: "Preparation file not found." }, { status: 404 });
  }
  return updateInterviewPreparation(params.id, params.scheduleId, params.fileId, {
    user_id: null,
    email: context.candidate.account_email || context.candidate.email,
    display_name: context.candidate.name,
  }, { remove: true }, context.candidateId);
}
