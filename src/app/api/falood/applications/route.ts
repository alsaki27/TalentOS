// src/app/api/falood/applications/route.ts
// CRUD for falood_saved_applications — replaces Prisma-based resumify-next API
// Uses TalentOS's native Neon driver.

import { NextRequest, NextResponse } from "next/server";
import { query, queryOne, execute } from "@/server/db/neon";
import { resumifyResumeDataToExportDocument } from "@/lib/falood/resumeDocumentAdapters";

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

    const row = await queryOne<any>(
      `UPDATE falood_saved_applications
       SET ${updates.join(", ")}
       WHERE id = $${values.length + 1}
       RETURNING id, created_at AS "createdAt", updated_at AS "updatedAt",
                 name, job_description AS "jobDescription", company_name AS "companyName",
                 skills, resume_data AS "resumeData", chat_history AS "chatHistory", versions`,
      [...values, id]
    );

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
      const match = /^base_resume:([0-9a-f-]{36})$/i.exec(row.name.trim());
      if (match) {
        const baseResumeId = match[1];
        try {
          const baseRow = await queryOne<{ content: any }>(
            "SELECT content FROM base_resumes WHERE id = $1",
            [baseResumeId]
          );
          if (baseRow) {
            const converted = resumifyResumeDataToExportDocument(body.resumeData);
            // Merge onto the existing content rather than replacing it
            // wholesale: the resumify editor has no concept of
            // certifications or the base resume's presentation "formatting"
            // (styleId/margins/etc.) at all, so a full overwrite would
            // silently delete them. Only the fields the Tailor Studio can
            // actually edit are synced.
            //
            // customSections is a genuine, actively-edited field here (this
            // route IS the save path for /falood/studio/tailor/[id], which
            // renders the real ResumeForm/CustomSectionsForm editor - a prior
            // version of this comment incorrectly assumed the caller was the
            // A4Preview/SectionSidebar stack, which has no custom-section UI
            // and, it turns out, doesn't even save through this route).
            // resumifyResumeDataToExportDocument() reshapes customSections
            // into the canonical { bullets } shape for the AI-pipeline
            // consumers, which drops the Resumify-native fields
            // (content/visible/type/order/placement) that CustomSectionsForm
            // and the base editor's own preview templates depend on
            // (templates filter on `visible`). Use body.resumeData's raw,
            // untouched customSections array instead of the converted one so
            // the round-trip back into base_resumes.content is lossless -
            // exactly what the base editor itself will read back later.
            const existingContent =
              baseRow.content && typeof baseRow.content === "object" && !Array.isArray(baseRow.content)
                ? baseRow.content
                : {};
            const rawCustomSections = Array.isArray((body.resumeData as any)?.customSections)
              ? (body.resumeData as any).customSections
              : converted.customSections;
            const mergedContent = {
              ...existingContent,
              header: converted.header,
              summary: converted.summary,
              skills: converted.skills,
              experience: converted.experience,
              education: converted.education,
              projects: converted.projects,
              customSections: rawCustomSections,
            };
            await execute(
              "UPDATE base_resumes SET content = $1::jsonb, updated_at = NOW() WHERE id = $2",
              [JSON.stringify(mergedContent), baseResumeId]
            );
          }
        } catch (syncErr: any) {
          console.error(
            "[Falood Applications PATCH] Base resume sync failed (non-critical):",
            syncErr?.message || syncErr
          );
        }
      }
    }

    return NextResponse.json({ success: true, data: normalizeRow(row) });
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
