// POST /api/extension/v1/capture-job
// Scope: extension:job:capture
// Stores a captured job posting in extension_captured_jobs (staging table).

import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/server/db/neon";
import { authenticateExtension, checkRequiredHeaders, checkIdempotencyKey, extensionError, EXTENSION_SCOPES } from "@/lib/extensionAuth";

export async function POST(request: NextRequest) {
  const headerError = checkRequiredHeaders(request);
  if (headerError) return headerError;
  const idemError = checkIdempotencyKey(request);
  if (idemError) return idemError;

  const auth = await authenticateExtension(request, EXTENSION_SCOPES.jobCapture);
  if (auth instanceof NextResponse) return auth;
  try {
    const body = await request.json();
    const { title, applyUrl, jdText, company, location, sourceSite, salary, atsDetected, screenshotUrl } = body;

    if (!title || !applyUrl || !jdText) {
      return extensionError("validation_error", "title, applyUrl, and jdText are required.", 400);
    }

    const idempotencyKey = request.headers.get("idempotency-key")!;
    const client = request.headers.get("x-talentos-client")!;

    // Dedup by idempotency key first
    const existingByIdem = await queryOne<{ id: string }>(
      `SELECT id FROM extension_captured_jobs WHERE idempotency_key = $1`,
      [idempotencyKey]
    );
    if (existingByIdem) {
      return NextResponse.json({ jobId: existingByIdem.id, duplicate: true });
    }

    // Dedup by apply_url
    const existingByUrl = await queryOne<{ id: string }>(
      `SELECT id FROM extension_captured_jobs WHERE apply_url = $1`,
      [applyUrl]
    );
    if (existingByUrl) {
      return NextResponse.json({ jobId: existingByUrl.id, duplicate: true });
    }

    const row = await queryOne<{ id: string }>(
      `INSERT INTO extension_captured_jobs
         (title, company, location, jd_text, apply_url, source_site, salary, ats_detected, screenshot_url, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [title, company ?? null, location ?? null, jdText, applyUrl, sourceSite ?? null, salary ?? null, atsDetected ?? null, screenshotUrl ?? null, idempotencyKey]
    );

    return NextResponse.json({ jobId: row!.id, duplicate: false }, { status: 201 });
  } catch (err) {
    return extensionError("internal_error", String(err), 500);
  }
}