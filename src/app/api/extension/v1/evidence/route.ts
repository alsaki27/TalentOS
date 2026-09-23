// POST /api/extension/v1/evidence
// Scope: extension:evidence:write
// Stores post-submission application evidence (screenshot + confirmation scrape).

import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/server/db/neon";
import { authenticateExtension, checkRequiredHeaders, checkIdempotencyKey, extensionError, EXTENSION_SCOPES, withExtensionCors } from "@/lib/extensionAuth";

export async function POST(request: NextRequest) {
  return withExtensionCors(async (req) => {
    const headerError = checkRequiredHeaders(req);
    if (headerError) return headerError;
    const idemError = checkIdempotencyKey(req);
    if (idemError) return idemError;

    const auth = await authenticateExtension(req, EXTENSION_SCOPES.evidenceWrite);
    if (auth instanceof NextResponse) return auth;

    try {
      const body = await req.json();
      const { applicationId, screenshotUrl, confirmationScrape } = body;

      if (!applicationId) {
        return extensionError("validation_error", "applicationId is required.", 400);
      }

      const app = await queryOne<{ id: string }>(
        `SELECT id FROM applications WHERE id = $1`,
        [applicationId]
      );
      if (!app) return extensionError("not_found", "Application not found.", 404);

      if (screenshotUrl) {
        const existing = await queryOne<{ id: string }>(
          `SELECT id FROM application_evidence WHERE application_id = $1 AND screenshot_url = $2`,
          [applicationId, screenshotUrl]
        );
        if (existing) {
          return NextResponse.json({ evidenceId: existing.id, duplicate: true });
        }
      }

      const row = await queryOne<{ id: string }>(
        `INSERT INTO application_evidence
           (application_id, screenshot_url, confirmation_scrape)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [applicationId, screenshotUrl ?? null, confirmationScrape ? JSON.stringify(confirmationScrape) : null]
      );

      return NextResponse.json({ evidenceId: row!.id, duplicate: false }, { status: 201 });
    } catch (err) {
      return extensionError("internal_error", String(err), 500);
    }
  })(request);
}

export async function OPTIONS(request: NextRequest) {
  return withExtensionCors(async () => new NextResponse(null, { status: 204 }))(request);
}

