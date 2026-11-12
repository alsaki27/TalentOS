import { NextResponse } from "next/server";
import { getCanonicalBaseUrl } from "@/server/runtimeConfig";
import { assertBrowserWorkerPrepareEnabled, BrowserWorkerPrepareError } from "@/server/services/browserWorkerPrepareService";

export const privateHeaders = { "Cache-Control": "no-store, private" };

function operatorOrigin(request: Request): string {
  if (process.env.NODE_ENV !== "production" && !process.env.TALENTOS_BASE_URL && !process.env.APP_BASE_URL) {
    const url = new URL(request.url);
    if (["http:", "https:"].includes(url.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      return url.origin;
    }
  }
  return getCanonicalBaseUrl();
}

export function assertStaffOperatorOrigin(request: Request): void {
  // Terminal clients use a staff session without a browser Origin header.
  const origin = request.headers.get("origin");
  if (origin !== null && origin !== operatorOrigin(request)) {
    throw new BrowserWorkerPrepareError(403, "Same-origin operator request required");
  }
}

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
