import { NextResponse } from "next/server";
import { getCandidatePortalInterviews } from "@/lib/candidatePortalDashboardService";
import { requireCurrentCandidate } from "@/server/auth/candidateAuth";

export const dynamic = "force-dynamic";

export async function GET() {
  const { context, response } = await requireCurrentCandidate();
  if (response) return response;
  const interviews = await getCandidatePortalInterviews(context.candidateId);
  return NextResponse.json({ interviews });
}
