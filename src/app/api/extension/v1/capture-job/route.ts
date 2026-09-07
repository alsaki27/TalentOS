// POST /api/extension/v1/capture-job
// Scope: extension:job:capture
// Stores a captured job posting in extension_captured_jobs (staging table).

import { NextRequest, NextResponse } from "next/server";
import { authenticateExtension, checkRequiredHeaders, checkIdempotencyKey, extensionError, EXTENSION_SCOPES, withExtensionCors } from "@/lib/extensionAuth";
import { createJob } from "@/server/repositories/jobsRepository";

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

      // You can store atsDetected or screenshotUrl in notes if you want to keep them
      const notes = [
        atsDetected && atsDetected !== 'Unknown' ? `ATS: ${atsDetected}` : '',
        screenshotUrl ? `Screenshot: ${screenshotUrl}` : ''
      ].filter(Boolean).join('\\n');

      // Duplicate check is now the normalized apply-link fingerprint (see
      // jobDuplicateGuard.ts) rather than a raw exact-string apply_url match
      // - the previous check missed the same posting reached via a link
      // that only differs by tracking params, case, or a trailing slash.
      const outcome = await createJob({
        title,
        company: company ?? null,
        location: location ?? null,
        description_text: jdText,
        apply_url: applyUrl,
        source: "extension",
        salary_range: salary ?? null,
        notes: notes || null,
      });

      if (outcome.status === "duplicate") {
        return NextResponse.json({
          jobId: outcome.existing.id,
          duplicate: true,
          existingJob: { title: outcome.existing.title, company: outcome.existing.company, createdAt: outcome.existing.created_at },
        });
      }

      return NextResponse.json({ jobId: outcome.job.id, duplicate: false }, { status: 201 });
    } catch (err) {
      return extensionError("internal_error", String(err), 500);
    }
  })(request);
}

export async function OPTIONS(request: NextRequest) {
  return withExtensionCors(async () => new NextResponse(null, { status: 204 }))(request);
}