import { NextResponse } from "next/server";
import { recordPrepareResult, readPrepareJson } from "@/server/services/browserWorkerPrepareService";
import { prepareResponse } from "../../../_http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: { id: string } }) {
  return prepareResponse(async () => NextResponse.json(await recordPrepareResult(request, params.id, await readPrepareJson(request))));
}
