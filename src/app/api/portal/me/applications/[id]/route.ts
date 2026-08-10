import { NextResponse } from "next/server";
import { requireCurrentCandidate } from "@/server/auth/candidateAuth";
import { getCandidatePortalApplicationDetail } from "@/lib/candidatePortalDashboardService";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentCandidate();
  if (response) return response;

  const application = await getCandidatePortalApplicationDetail(context.candidateId, params.id);
  if (!application) return NextResponse.json({ error: "Application not found" }, { status: 404 });
  return NextResponse.json(application);
}
