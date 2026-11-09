// src/app/api/application-queue/page-fit/route.ts
// GET -> lightweight batch refresh of one_page_fit_score/page_fit_metrics for
// a set of application ids. Include the version ID so a result from an older
// resume cannot overwrite the badge after a workflow swaps the linked version.

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { INITIAL_RESUME_DATA, normalizeImportedResumeData } from "@/components/falood/resumify/utils/importedResumeData";
import { isResumeDataEffectivelyEmpty } from "@/lib/falood/resumeEmptyCheck";
import { LEGACY_PAGE_FIT_BATCH_SIZE } from "@/lib/falood/studioPageFit";
import { studioDocumentToResumeData } from "@/lib/falood/studioDocumentToResumeData";
import { query } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const url = new URL(req.url);
  const ids = (url.searchParams.get("ids") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 200);
  if (ids.length === 0) return NextResponse.json({ items: [] });

  if (url.searchParams.get("layout") === "legacy") {
    const batch = ids.filter((id) => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)).slice(0, LEGACY_PAGE_FIT_BATCH_SIZE);
    if (!batch.length) return NextResponse.json({ items: [] });
    const rows = await query<{
      id: string; resume_version_id: string; page_fit_resume_updated_at: string | null;
      studio_data: unknown; canonical_data: unknown;
    }>(
      `SELECT a.id, rv.id AS resume_version_id, rv.updated_at AS page_fit_resume_updated_at,
              studio.resume_data AS studio_data, rv.content AS canonical_data, NOW() AS page_fit_read_at
       FROM applications a
       JOIN application_resume_versions rv ON rv.id = a.tailored_resume_version_id
       LEFT JOIN LATERAL (
         SELECT s.resume_data FROM falood_saved_applications s
         WHERE s.name = 'application_resume_version:' || rv.id::text
         ORDER BY s.updated_at DESC NULLS LAST, s.id DESC LIMIT 1
       ) studio ON TRUE
       WHERE a.id = ANY($1::uuid[])
         AND CASE WHEN jsonb_typeof(rv.page_fit_metrics->'pageUtilizations') = 'array'
                  THEN jsonb_array_length(rv.page_fit_metrics->'pageUtilizations') = 0 ELSE TRUE END`,
      [batch],
    );
    const items = rows.flatMap(({ studio_data, canonical_data, ...row }) => {
      for (const [value, savedDraft] of [[studio_data, true], [canonical_data, false]] as const) {
        if (!value) continue;
        try {
          const source = (typeof value === "string" ? JSON.parse(value) : value) as Record<string, unknown> | null;
          // A saved draft follows Studio's import path. Canonical documents
          // first go through the same adapter used by Open in Studio.
          const data = savedDraft && source?.personalInfo
            ? normalizeImportedResumeData(Object.fromEntries(Object.keys(INITIAL_RESUME_DATA)
                .filter((key) => Object.hasOwn(source, key)).map((key) => [key, source[key]])))
            : studioDocumentToResumeData(source);
          if (!isResumeDataEffectivelyEmpty(data)) return [{ ...row, data }];
        } catch {
          // Try the canonical copy if the saved Studio draft cannot be read.
        }
      }
      return [];
    });
    return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
  }

  const items = await query<{ id: string; resume_version_id: string | null; one_page_fit_score: number | null; page_fit_metrics: Record<string, unknown> | null; page_fit_read_at: string; page_fit_resume_updated_at: string | null }>(
    `SELECT a.id, a.tailored_resume_version_id AS resume_version_id, rv.one_page_fit_score, rv.page_fit_metrics,
            NOW() AS page_fit_read_at, rv.updated_at AS page_fit_resume_updated_at
     FROM applications a
     LEFT JOIN application_resume_versions rv ON rv.id = a.tailored_resume_version_id
     WHERE a.id = ANY($1::uuid[])`,
    [ids]
  );

  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
}
