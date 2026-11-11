import { NextResponse } from "next/server";
import { assertBrowserWorkerPrepareEnabled, BrowserWorkerPrepareError } from "@/server/services/browserWorkerPrepareService";

export const privateHeaders = { "Cache-Control": "no-store, private" };
export async function prepareResponse(action: () => Promise<Response>): Promise<Response> {
  try {
    assertBrowserWorkerPrepareEnabled();
    const response = await action();
    response.headers.set("Cache-Control", "no-store, private");
    return response;
  } catch (error) {
    if (error instanceof BrowserWorkerPrepareError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: privateHeaders });
    }
    // Database/storage errors can contain source paths and private metadata.
    return NextResponse.json({ error: "Browser worker prepare operation failed" }, { status: 500, headers: privateHeaders });
  }
}
