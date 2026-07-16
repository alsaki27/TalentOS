// GET /api/extension/v1/adapters/manifest
// Scope: extension:adapters:read
// Returns the ATS adapter manifest with actual adapter maturity.

import { NextRequest, NextResponse } from "next/server";
import { authenticateExtension, checkRequiredHeaders, extensionError, EXTENSION_SCOPES, withExtensionCors } from "@/lib/extensionAuth";

export async function GET(request: NextRequest) {
  return withExtensionCors(async (req) => {
    const headerError = checkRequiredHeaders(req);
    if (headerError) return headerError;

    const auth = await authenticateExtension(req, EXTENSION_SCOPES.adaptersRead);
    if (auth instanceof NextResponse) return auth;

    try {
      return NextResponse.json({
        manifestVersion: "1.0.0",
        updatedAt: new Date().toISOString(),
        adapters: [
          { name: "greenhouse", version: "1.0.0", maturity: "verified", checksum: "greenhouse-v1" },
          { name: "lever", version: "1.0.0", maturity: "draft", checksum: "lever-v1" },
          { name: "ashby", version: "1.0.0", maturity: "draft", checksum: "ashby-v1" },
          { name: "workday", version: "1.0.0", maturity: "draft", checksum: "stub" },
          { name: "icims", version: "1.0.0", maturity: "draft", checksum: "stub" },
        ],
      });
    } catch (err) {
      return extensionError("internal_error", String(err), 500);
    }
  })(request);
}

export async function OPTIONS(request: NextRequest) {
  return withExtensionCors(async () => new NextResponse(null, { status: 204 }))(request);
}

