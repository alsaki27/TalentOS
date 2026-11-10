// src/app/api/falood/applications/route.ts
// CRUD for falood_saved_applications — replaces Prisma-based resumify-next API
// Uses TalentOS's native Neon driver.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/auth";
import { query, queryOne, execute } from "@/server/db/neon";
import {
  mergeResumifyEditorIntoBaseResume,
} from "@/lib/falood/resumeDocumentAdapters";
import { backgroundDispatch } from "@/server/lib/waitUntil";
import { isResumeDataEffectivelyEmpty } from "@/lib/falood/resumeEmptyCheck";
import { measureResumePageFitMetrics } from "@/lib/falood/resumePageFitMeasurement";
import { studioPageFit } from "@/lib/falood/studioPageFit";

export const runtime = "nodejs";

function safeParseJson<T>(value: unknown): T | unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as T;
  } catch {
    return value;
  }
}

function normalizeRow(row: any) {
  if (!row) return row;
  return {
    ...row,
    skills: safeParseJson<string[]>(row.skills),
    resumeData: safeParseJson<any>(row.resumeData),
    chatHistory: safeParseJson<any[]>(row.chatHistory),
    versions: safeParseJson<any[]>(row.versions || '[]'),
  };
}

async function resolveArchiveContext(name: unknown) {
  if (typeof name !== "string") return null;
  const match = /^application_resume_version:([0-9a-f-]{36})$/i.exec(name.trim());
  if (!match) return null;

  const resumeVersionId = match[1];
  const version = await queryOne<{ application_id: string | null; candidate_id: string; target_job_id: string }>(
    `SELECT application_id, candidate_id, target_job_id
     FROM application_resume_versions WHERE id = $1`,
    [resumeVersionId]
  );
  if (!version) return null;

  let applicationId = version.application_id;
  if (!applicationId) {
    const packet = await queryOne<{ application_id: string }>(
      `SELECT application_id FROM application_packets
       WHERE resume_version_id = $1 OR final_resume_version_id = $1 LIMIT 1`,
      [resumeVersionId]
    );
    applicationId = packet?.application_id ?? null;
  }
  if (!applicationId) {
    const fallback = await queryOne<{ id: string }>(
      `SELECT a.id
       FROM applications a
       JOIN target_jobs tj ON tj.job_id = a.job_id
       WHERE a.candidate_id = $1 AND tj.id = $2
       ORDER BY a.applied_at DESC NULLS LAST, a.created_at DESC NULLS LAST
       LIMIT 1`,
      [version.candidate_id, version.target_job_id]
    );
    applicationId = fallback?.id ?? null;
  }

  return applicationId ? { applicationId, resumeVersionId } : null;
}

async function resolveJobLocation(name: unknown): Promise<{ enabled: boolean; location: string | null; issue: string | null }> {
  if (typeof name !== "string") return { enabled: false, location: null, issue: null };
  const match = /^application_resume_version:([0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i.exec(name.trim());
  if (!match) return { enabled: false, location: null, issue: null };

  const row = await queryOne<{ linked_job_id: string | null; job_id: string | null; location: string | null }>(
    `SELECT COALESCE(arv.job_id, a.job_id, tj.job_id) AS linked_job_id,
            j.id AS job_id,
            NULLIF(BTRIM(j.location), '') AS location
       FROM application_resume_versions arv
       LEFT JOIN applications a ON a.id = arv.application_id
       LEFT JOIN target_jobs tj ON tj.id = arv.target_job_id
       LEFT JOIN jobs j ON j.id = COALESCE(arv.job_id, a.job_id, tj.job_id)
      WHERE arv.id = $1`,
    [match[1]]
  );
  if (!row) return { enabled: true, location: null, issue: "Resume Studio couldn't find the linked TalentOS job record. No changes were made." };
  if (!row.linked_job_id) return { enabled: true, location: null, issue: "This resume isn't linked to a TalentOS job, so there is no job location to apply." };
  if (!row.job_id) return { enabled: true, location: null, issue: "TalentOS couldn't find the job record linked to this resume. No changes were made." };
  if (!row.location) return { enabled: true, location: null, issue: "This TalentOS job has no saved location. Add a location to the job record, then reload Resume Studio." };
  return { enabled: true, location: row.location.trim(), issue: null };
}

// GET — list all, or get one by ?id=
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");

  try {
    if (id) {
      const row = await queryOne<any>(
        `SELECT id, created_at AS "createdAt", updated_at AS "updatedAt",
                name, job_description AS "jobDescription", company_name AS "companyName",
                skills, resume_data AS "resumeData", chat_history AS "chatHistory",
                candidate_id AS "candidateId", versions
         FROM falood_saved_applications WHERE id = $1`,
        [id]
      );
      if (!row) {
        return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
      }
      const data = normalizeRow(row);
      data.archiveContext = await resolveArchiveContext(row.name);
      try {
        const jobLocation = await resolveJobLocation(row.name);
        data.jobLocation = jobLocation.location;
        data.jobLocationSyncEnabled = jobLocation.enabled;
        data.jobLocationLookupError = jobLocation.issue;
      } catch (error) {
        console.error("[Falood Applications GET] Failed to load linked job location", error);
        data.jobLocation = null;
        data.jobLocationSyncEnabled = typeof row.name === "string" && /^application_resume_version:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(row.name.trim());
        data.jobLocationLookupError = "TalentOS could not load the saved location for this job. Refresh Resume Studio and try again.";
      }
      return NextResponse.json({ success: true, data });
    }

    const rows = await query<any>(
      `SELECT id, created_at AS "createdAt", updated_at AS "updatedAt",
              name, job_description AS "jobDescription", company_name AS "companyName",
              skills, resume_data AS "resumeData", chat_history AS "chatHistory", versions
       FROM falood_saved_applications ORDER BY updated_at DESC`
    );
    return NextResponse.json({ success: true, data: rows.map(normalizeRow) });
  } catch (e: any) {
    console.error("[Falood Applications GET]", e);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

// POST — create a new saved application
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, jobDescription, companyName, skills, resumeData, chatHistory, candidateId } = body;

    if (!resumeData) {
      return NextResponse.json({ success: false, error: "Missing resumeData" }, { status: 400 });
    }

    const row = await queryOne<any>(
      `INSERT INTO falood_saved_applications
         (name, job_description, company_name, skills, resume_data, chat_history, candidate_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, created_at AS "createdAt"`,
      [
        name || null,
        jobDescription || null,
        companyName || null,
        skills || [],
        JSON.stringify(resumeData),
        JSON.stringify(chatHistory || []),
        candidateId || null,
      ]
    );

    return NextResponse.json({ success: true, data: row });
  } catch (e: any) {
    console.error("[Falood Applications POST]", e);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

// PATCH — update an existing saved application by ?id=
export async function PATCH(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ success: false, error: "Missing id" }, { status: 400 });
  }

  try {
    const body = await req.json();
    const updates: string[] = [];
    const values: unknown[] = [];

    if ("name" in body) {
      updates.push(`name = $${values.length + 1}`);
      values.push(body.name || null);
    }

    if ("jobDescription" in body) {
      updates.push(`job_description = $${values.length + 1}`);
      values.push(body.jobDescription || null);
    }

    if ("companyName" in body) {
      updates.push(`company_name = $${values.length + 1}`);
      values.push(body.companyName || null);
    }

    if ("skills" in body) {
      updates.push(`skills = $${values.length + 1}`);
      values.push(body.skills || []);
    }

    if ("resumeData" in body) {
      // Structural backstop against the exit-flush race (see
      // resumeEmptyCheck.ts for the full incident writeup): refuse any write
      // that would replace existing real content with the blank-placeholder
      // shape, regardless of what client-side bug (this one or a future one)
      // produced it. A brand-new session's first save is still allowed -
      // this only blocks a non-empty -> empty regression.
      if (isResumeDataEffectivelyEmpty(body.resumeData)) {
        const existingRow = await queryOne<{ resume_data: unknown }>(
          `SELECT resume_data FROM falood_saved_applications WHERE id = $1`,
          [id]
        );
        const existingData = existingRow ? (safeParseJson(existingRow.resume_data) as any) : null;
        if (existingRow && !isResumeDataEffectivelyEmpty(existingData)) {
          console.error(`[Falood Applications PATCH] Refused to overwrite non-empty resume_data with an empty one for id=${id}`);
          return NextResponse.json(
            {
              success: false,
              error: "Refusing to save: this would replace existing resume content with a blank resume. Reload the page and try again - if the problem persists, the page may not have finished loading before you tried to save.",
            },
            { status: 409 }
          );
        }
      }
      updates.push(`resume_data = $${values.length + 1}`);
      values.push(JSON.stringify(body.resumeData));
    }

    if ("chatHistory" in body) {
      updates.push(`chat_history = $${values.length + 1}`);
      values.push(JSON.stringify(body.chatHistory || []));
    }

    if ("versions" in body) {
      updates.push(`versions = $${values.length + 1}`);
      values.push(JSON.stringify(body.versions || []));
    }

    if (updates.length === 0) {
      return NextResponse.json({ success: false, error: "No fields to update" }, { status: 400 });
    }

    updates.push(`updated_at = NOW()`);

    const linked = "resumeData" in body ? await queryOne<{ id: string; content: unknown }>(
      `SELECT rv.id, rv.content
       FROM falood_saved_applications s
       JOIN application_resume_versions rv ON rv.id = CASE
         WHEN trim(s.name) ~* '^application_resume_version:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
         THEN split_part(trim(s.name), ':', 2)::uuid END
       WHERE s.id = $1`,
      [id]
    ) : null;
    const studioUpdate = `UPDATE falood_saved_applications
       SET ${updates.join(", ")}
       WHERE id = $${values.length + 1}
       RETURNING id, created_at AS "createdAt", updated_at AS "updatedAt", name`;
    values.push(id);
    let row: { id: string; createdAt: string; updatedAt: string; name: string | null; resumeVersionId?: string } | null;

    if (linked) {
      const merged = mergeResumifyEditorIntoBaseResume(safeParseJson(linked.content), body.resumeData);
      // Preserve the server fallback for older clients. If Studio explicitly
      // reports that its layout is unavailable, clear the previous badge.
      const metrics = "pageUtilizations" in body
        ? studioPageFit(body.resumeData, body.pageUtilizations)
        : measureResumePageFitMetrics(merged) ?? null;
      const score = typeof metrics?.contentUtilization === "number"
        ? Math.round(metrics.contentUtilization * 1000) / 10 : null;
      const editor = await getCurrentUserContext().catch(() => null);
      const first = values.length + 1;
      // Both copies and the badge commit together. A failed sync rolls back
      // the draft write too, so Save can be retried without reporting success.
      row = await queryOne(
        `WITH saved AS (${studioUpdate}), synced AS (
           UPDATE application_resume_versions rv
              SET content = $${first}::jsonb,
                  page_fit_metrics = $${first + 1}::jsonb,
                  one_page_fit_score = $${first + 2},
                  updated_by_user_id = $${first + 3},
                  updated_source = $${first + 4},
                  updated_at = NOW()
             FROM saved
            WHERE rv.id = $${first + 5}
              AND lower(trim(saved.name)) = 'application_resume_version:' || rv.id::text
           RETURNING rv.id
         )
         SELECT saved.*, synced.id AS "resumeVersionId" FROM saved LEFT JOIN synced ON TRUE`,
        [...values, JSON.stringify(merged), metrics && JSON.stringify(metrics), score,
          editor?.profile.user_id ?? null,
          editor ? "human_falood_studio_save" : "falood_studio_save_unattributed", linked.id],
      );
    } else {
      row = await queryOne(studioUpdate, values);
    }

    if (!row) {
      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }

    // This Tailor Studio session may represent a candidate's actual base
    // resume (created by copying from one - see the "base_resume:<id>" name
    // convention set at creation time). falood_saved_applications is its own,
    // separate table; the AI resume pipeline never reads it - only
    // base_resumes.content. Without this, edits made here look saved (they
    // are - to this table) but are structurally invisible to Generate/
    // Regenerate, which keeps producing tailored resumes from the OLD base
    // resume content forever. Push resume-content edits back into
    // base_resumes in real time so the very next pipeline run picks them up.
    // Only runs when this save actually included resumeData - a
    // chatHistory-only or versions-only save has nothing new to sync.
    // Best-effort: a sync failure must never fail the Tailor Studio's own
    // save, which has already succeeded by this point.
    if ("resumeData" in body && typeof row.name === "string") {
      const trimmedName = row.name.trim();
      const baseResumeMatch = /^base_resume:([0-9a-f-]{36})$/i.exec(trimmedName);
      if (baseResumeMatch) {
        const baseResumeId = baseResumeMatch[1];

        // The saved application is the authoritative write for this endpoint.
        // Mirroring the editor content into base_resumes is a derived sync and
        // must not make the Save button wait on two more database round trips.
        await backgroundDispatch(
          (async () => {
            try {
              const baseRow = await queryOne<{ content: any }>(
                "SELECT content FROM base_resumes WHERE id = $1",
                [baseResumeId]
              );
              if (!baseRow) return;

              const mergedContent = mergeResumifyEditorIntoBaseResume(
                baseRow.content,
                body.resumeData,
              );
              await execute(
                "UPDATE base_resumes SET content = $1::jsonb, updated_at = NOW() WHERE id = $2",
                [JSON.stringify(mergedContent), baseResumeId]
              );
            } catch (syncErr: any) {
              console.error(
                "[Falood Applications PATCH] Base resume sync failed (non-critical):",
                syncErr?.message || syncErr
              );
            }
          })()
        );
      }
    }

    return NextResponse.json({
      success: true,
      data: { id: row.id, createdAt: row.createdAt, updatedAt: row.updatedAt, resumeVersionId: row.resumeVersionId },
    });
  } catch (e: any) {
    console.error("[Falood Applications PATCH]", e);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}

// DELETE — delete by ?id=
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ success: false, error: "Missing id" }, { status: 400 });
  }

  try {
    await execute("DELETE FROM falood_saved_applications WHERE id = $1", [id]);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("[Falood Applications DELETE]", e);
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
