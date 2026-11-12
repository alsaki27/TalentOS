import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { BrowserWorkerPrepareError, enrollPilotDevice, readPrepareJson } from "@/server/services/browserWorkerPrepareService";
import { assertStaffOperatorOrigin, prepareResponse } from "../../_http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST(request: Request) {
  return prepareResponse(async () => {
    const { context, response } = await requireCurrentUser(["admin", "manager"]);
    if (response) return response;
    if (!request.headers.has("origin")) throw new BrowserWorkerPrepareError(403, "Same-origin operator request required");
    assertStaffOperatorOrigin(request);
    return NextResponse.json(await enrollPilotDevice(await readPrepareJson(request), context.user.id), { status: 201 });
  });
}
