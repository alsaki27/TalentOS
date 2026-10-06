import { NextResponse } from "next/server";
import { requireCurrentCandidate } from "@/server/auth/candidateAuth";
import { getCandidatePortalTrainingAudit } from "@/lib/candidatePortalTrainingService";

export const dynamic = "force-dynamic";

/** Candidate-safe summary of the signed-in candidate's own training audit. */
export async function GET() {
  const { context, response } = await requireCurrentCandidate();
  if (response) return response;
  return NextResponse.json(await getCandidatePortalTrainingAudit(context.candidateId));
}
