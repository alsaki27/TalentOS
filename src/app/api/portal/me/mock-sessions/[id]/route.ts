import { NextResponse } from "next/server";
import { requireCurrentCandidate } from "@/server/auth/candidateAuth";
import { getCandidatePortalMockSession } from "@/lib/candidatePortalTrainingService";

export const dynamic = "force-dynamic";

/** One of the signed-in candidate's mock interviews, with its audit report and transcript. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentCandidate();
  if (response) return response;

  const session = await getCandidatePortalMockSession(context.candidateId, params.id);
  if (!session) return NextResponse.json({ error: "Mock interview not found" }, { status: 404 });
  return NextResponse.json(session);
}
