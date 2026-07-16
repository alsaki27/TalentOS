// POST /api/extension/v1/capture-job
// Scope: extension:job:capture
// Stores a captured job posting in extension_captured_jobs (staging table).

import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/server/db/neon";
import { authenticateExtension, checkRequiredHeaders, checkIdempotencyKey, extensionError, EXTENSION_SCOPES, withExtensionCors } from "@/lib/extensionAuth";

export async function POST(request: NextRequest) {
  return withExtensionCors(async (req) => {
    const headerError = checkRequiredHeaders(req);
    if (headerError) return headerError;
    const idemError = checkIdempotencyKey(req);
    if (idemError) return idemError;

    const auth = await authenticateExtension(req, EXTENSION_SCOPES.jobCapture);
    if (auth instanceof NextResponse) return auth;
    try {
      const body = await req.json();
      const { title, applyUrl, jdText, company, location, sourceSite, salary, atsDetected, screenshotUrl } = body;

      if (!title || !applyUrl || !jdText) {
        return extensionError("validation_error", "title, applyUrl, and jdText are required.", 400);
      }

      // Dedup by apply_url
      const existingByUrl = await queryOne<{ id: string }>(
        `SELECT id FROM jobs WHERE apply_url = $1`,
        [applyUrl]
      );
      if (existingByUrl) {
        return NextResponse.json({ jobId: existingByUrl.id, duplicate: true });
      }

      // You can store atsDetected or screenshotUrl in notes if you want to keep them
      const notes = [
        atsDetected && atsDetected !== 'Unknown' ? `ATS: ${atsDetected}` : '',
        screenshotUrl ? `Screenshot: ${screenshotUrl}` : ''
      ].filter(Boolean).join('\\n');

      const row = await queryOne<{ id: string }>(
        `INSERT INTO jobs
           (title, company, location, description_text, apply_url, source, salary_range, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          title, 
          company ?? null, 
          location ?? null, 
          jdText, 
          applyUrl, 
          "extension", 
          salary ?? null, 
          notes || null
        ]
      );

      return NextResponse.json({ jobId: row!.id, duplicate: false }, { status: 201 });
    } catch (err) {
      return extensionError("internal_error", String(err), 500);
    }
  })(request);
}

export async function OPTIONS(request: NextRequest) {
  return withExtensionCors(async () => new NextResponse(null, { status: 204 }))(request);
}