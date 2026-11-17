import { NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { readPrepareJson } from "@/server/services/browserWorkerPrepareService";
import { registerBrowserQueueWorker } from "@/server/services/browserWorkerQueueService";
import { assertQueueOperatorOrigin, queueResponse } from "../_http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return queueResponse(async () => {
    const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
    if (response) return response;
    assertQueueOperatorOrigin(request);
    return NextResponse.json(await registerBrowserQueueWorker(await readPrepareJson(request), context.user.id), { status: 201 });
  });
}
