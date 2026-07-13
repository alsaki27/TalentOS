// GET /api/extension/v1/adapters/manifest
// Scope: extension:adapters:read
// Returns the ATS adapter manifest. NOTE: this is placeholder/stub data, NOT a
// working set of per-site field-mapping rules. All adapters carry maturity: "draft";
// greenhouse/lever/ashby have provisional checksums ("*-v1") and workday/icims carry
// checksum: "stub". No table or config file backs this yet — until real adapter
// configs are wired in, treat every entry as unverified.

import { NextRequest, NextResponse } from "next/server";
import { authenticateExtension, checkRequiredHeaders, extensionError, EXTENSION_SCOPES } from "@/lib/extensionAuth";

export async function GET(request: NextRequest) {
  const headerError = checkRequiredHeaders(request);
  if (headerError) return headerError;

  const auth = await authenticateExtension(request, EXTENSION_SCOPES.adaptersRead);
  if (auth instanceof NextResponse) return auth;

  try {
    return NextResponse.json({
      manifestVersion: "1.0.0",
      updatedAt: new Date().toISOString(),
      adapters: [
        { name: "greenhouse", version: "1.0.0", maturity: "draft", checksum: "greenhouse-v1" },
        { name: "lever", version: "1.0.0", maturity: "draft", checksum: "lever-v1" },
        { name: "ashby", version: "1.0.0", maturity: "draft", checksum: "ashby-v1" },
        { name: "workday", version: "1.0.0", maturity: "draft", checksum: "stub" },
        { name: "icims", version: "1.0.0", maturity: "draft", checksum: "stub" },
      ],
    });
  } catch (err) {
    return extensionError("internal_error", String(err), 500);
  }
}