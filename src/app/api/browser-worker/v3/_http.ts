import { NextResponse } from "next/server";
import { BrowserWorkerPrepareError } from "@/server/services/browserWorkerPrepareService";
import { assertBrowserWorkerQueueEnabled, BrowserWorkerQueueError } from "@/server/services/browserWorkerQueueService";
import { assertStaffOperatorOrigin } from "../v2/_http";

const privateHeaders = { "Cache-Control": "no-store, private" };

export function assertQueueOperatorOrigin(request: Request): void {
  if (!request.headers.has("Origin")) {
    throw new BrowserWorkerQueueError(403, "Same-origin operator request required");
  }
  assertStaffOperatorOrigin(request);
}

export async function queueResponse(action: () => Promise<Response>): Promise<Response> {
  try {
    assertBrowserWorkerQueueEnabled();
    const response = await action();
    response.headers.set("Cache-Control", privateHeaders["Cache-Control"]);
    return response;
  } catch (error) {
    if (error instanceof BrowserWorkerQueueError || error instanceof BrowserWorkerPrepareError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: privateHeaders });
    }
    return NextResponse.json({ error: "Dedicated browser worker queue operation failed" }, {
      status: 500, headers: privateHeaders,
    });
  }
}
