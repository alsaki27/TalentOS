// GET /api/extension/v1/resume-download?url=<fileUrl>
// Scope: extension:resume:read
// Proxies a resume file download so the extension can fetch it without CORS issues.

import { NextRequest, NextResponse } from "next/server";
import { authenticateExtension, checkRequiredHeaders, extensionError, EXTENSION_SCOPES, withExtensionCors } from "@/lib/extensionAuth";

export async function GET(request: NextRequest) {
  return withExtensionCors(async (req) => {
    const headerError = checkRequiredHeaders(req);
    if (headerError) return headerError;

    const auth = await authenticateExtension(req, EXTENSION_SCOPES.resumeRead);
    if (auth instanceof NextResponse) return auth;

    try {
      const url = req.nextUrl.searchParams.get("url");
      if (!url) {
        return extensionError("validation_error", "url query parameter is required.", 400);
      }

      if (!url.startsWith("https://")) {
        return extensionError("validation_error", "url must be an HTTPS URL.", 400);
      }

      const res = await fetch(url);
      if (!res.ok) {
        return extensionError("proxy_error", `Failed to fetch resume: HTTP ${res.status}`, 502);
      }

      const contentType = res.headers.get("content-type") || "application/pdf";
      const buffer = await res.arrayBuffer();

      const urlPath = new URL(url).pathname;
      const segments = urlPath.split("/");
      const rawFileName = segments[segments.length - 1] || "resume.pdf";
      const fileName = rawFileName.includes(".") ? rawFileName : `${rawFileName}.pdf`;

      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": `attachment; filename="${fileName}"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (err) {
      return extensionError("internal_error", String(err), 500);
    }
  })(request);
}

export async function OPTIONS(request: NextRequest) {
  return withExtensionCors(async () => new NextResponse(null, { status: 204 }))(request);
}
