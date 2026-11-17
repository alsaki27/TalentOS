import { NextResponse } from "next/server";
import { readPrepareJson } from "@/server/services/browserWorkerPrepareService";
import { claimBrowserQueueJob } from "@/server/services/browserWorkerQueueService";
import { queueResponse } from "../_http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return queueResponse(async () => {
    const claim = await claimBrowserQueueJob(request, await readPrepareJson(request));
    return claim ? NextResponse.json(claim) : new Response(null, { status: 204 });
  });
}
