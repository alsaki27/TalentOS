import { NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { readPrepareJson } from "@/server/services/browserWorkerPrepareService";
import { enqueueBrowserQueueJob, getBrowserQueueJob, listBrowserQueueWorkers } from "@/server/services/browserWorkerQueueService";
import { assertQueueOperatorOrigin, queueResponse } from "../_http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return queueResponse(async () => {
    const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
    if (response) return response;
    const applicationId = new URL(request.url).searchParams.get("applicationId");
    return NextResponse.json(await (applicationId === null ? listBrowserQueueWorkers() : getBrowserQueueJob(applicationId)));
  });
}

export function POST(request: Request) {
  return queueResponse(async () => {
    const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
    if (response) return response;
    assertQueueOperatorOrigin(request);
    const result = await enqueueBrowserQueueJob(
      await readPrepareJson(request), context.user.id, request.headers.get("Idempotency-Key"),
    );
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  });
}
