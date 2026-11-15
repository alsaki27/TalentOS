import { NextResponse } from "next/server";
import { requireCurrentCandidate } from "@/server/auth/candidateAuth";
import { UUID_PATTERN, downloadInterviewPreparation } from "@/server/services/interviewPreparationFiles";

export async function GET(request: Request, { params }: { params: { id: string; fileId: string } }) {
  const { context, response } = await requireCurrentCandidate();
  if (response) return response;
  if (![params.id, params.fileId].every((id) => UUID_PATTERN.test(id))) {
    return NextResponse.json({ error: "Preparation file not found." }, { status: 404 });
  }
  return downloadInterviewPreparation(request, params.id, null, params.fileId, context.candidateId);
}
