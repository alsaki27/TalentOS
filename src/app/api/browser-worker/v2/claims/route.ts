import { NextResponse } from "next/server";
import { claimPrepareApplication, readPrepareJson } from "@/server/services/browserWorkerPrepareService";
import { prepareResponse } from "../_http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return prepareResponse(async () => {
    const claim = await claimPrepareApplication(request, await readPrepareJson(request));
    return claim ? NextResponse.json(claim) : new NextResponse(null, { status: 204 });
  });
}
