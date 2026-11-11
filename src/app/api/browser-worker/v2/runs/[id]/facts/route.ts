import { NextResponse } from "next/server";
import { authorizeLivePrepareLease } from "@/server/services/browserWorkerPrepareService";
import { getApprovedApplicationAnswers } from "@/server/services/candidateApplicationFactsService";
import { prepareResponse } from "../../../_http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: { id: string } }) {
  return prepareResponse(async () => {
    const run = await authorizeLivePrepareLease(request, params.id);
    const facts = await getApprovedApplicationAnswers(run.candidateId, run.jobId);
    await authorizeLivePrepareLease(request, params.id);
    return NextResponse.json(facts);
  });
}
