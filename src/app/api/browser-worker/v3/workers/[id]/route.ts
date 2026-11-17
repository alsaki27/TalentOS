import { NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { revokeBrowserQueueWorker } from "@/server/services/browserWorkerQueueService";
import { assertQueueOperatorOrigin, queueResponse } from "../../_http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function DELETE(request: Request, { params }: { params: { id: string } }) {
  return queueResponse(async () => {
    const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
    if (response) return response;
    assertQueueOperatorOrigin(request);
    return NextResponse.json(await revokeBrowserQueueWorker(params.id, context.user.id));
  });
}
