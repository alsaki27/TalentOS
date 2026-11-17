import { NextResponse } from "next/server";
import { getBrowserQueueFacts } from "@/server/services/browserWorkerQueueService";
import { queueResponse } from "../../../_http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request, { params }: { params: { id: string } }) {
  return queueResponse(async () => NextResponse.json(await getBrowserQueueFacts(request, params.id)));
}
