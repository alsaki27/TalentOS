import { NextResponse } from "next/server";
import { readPrepareJson } from "@/server/services/browserWorkerPrepareService";
import { recordBrowserQueueResult } from "@/server/services/browserWorkerQueueService";
import { queueResponse } from "../../../_http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request, { params }: { params: { id: string } }) {
  return queueResponse(async () => NextResponse.json(
    await recordBrowserQueueResult(request, params.id, await readPrepareJson(request)),
  ));
}
