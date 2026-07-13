// src/app/api/falood/applications/route.ts
// CRUD for falood_saved_applications — replaces Prisma-based resumify-next API
// Uses TalentOS's native Neon driver.

import { NextRequest, NextResponse } from "next/server";
import { query, queryOne, execute } from "@/server/db/neon";

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
  };
}

// GET — list all, or get one by ?id=
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");

  try {
    if (id) {
      let row = await queryOne<any>(
        `SELECT id, created_at AS "createdAt", updated_at AS "updatedAt",
                job_description AS "jobDescription", company_name AS "companyName",
                skills, resume_data AS "resumeData", chat_history AS "chatHistory"
         FROM falood_saved_applications WHERE id = $1`,
        [id]
      );
      if (row) return NextResponse.json({ success: true, data: normalizeRow(row) });

      // Fallback 1: Multi-agent application workflow resumes
      row = await queryOne<any>(
        `SELECT id, workflow_id, created_at AS "createdAt", updated_at AS "updatedAt",
                resume_data AS "resumeData", ats_score AS "atsScore"
         FROM application_resume_versions WHERE id = $1`,
        [id]
      );
      if (row) {
        // Fetch target job details to populate jobDescription and companyName
        const ar = await queryOne<any>(`SELECT target_job_id FROM application_resume_versions WHERE id = $1`, [id]);
        if (ar?.target_job_id) {
            const tj = await queryOne<any>(`SELECT company_name, job_description FROM target_jobs WHERE id = $1`, [ar.target_job_id]);
            row.jobDescription = tj?.job_description || "";
            row.companyName = tj?.company_name || "";
        }
        
        // Fetch reasoning from artifacts
        let reasoningMessage = "";
        if (row.workflow_id) {
           const reviewArtifact = await queryOne<any>(
             `SELECT data FROM application_ai_workflow_artifacts 
              WHERE workflow_id = $1 AND automation_id = 'application_hiring_panel'`,
             [row.workflow_id]
           );
           if (reviewArtifact?.data) {
              const d = typeof reviewArtifact.data === 'string' ? JSON.parse(reviewArtifact.data) : reviewArtifact.data;
              const comment = d.overallComment || "";
              const edits = (d.requiredEdits || []).map((e: any) => `- ${e.description}`).join('\n');
              reasoningMessage = comment;
              if (edits) {
                  reasoningMessage += `\n\n**Things to Improve:**\n${edits}`;
              }
           }
        }
        
        row.chatHistory = [
          { role: 'assistant', content: `**ATS Score: ${row.atsScore ?? 'N/A'}/10**\n\n${reasoningMessage}` }
        ];

        return NextResponse.json({ success: true, data: normalizeRow(row) });
      }

      // Fallback 2: Base resumes
      row = await queryOne<any>(
        `SELECT id, created_at AS "createdAt", updated_at AS "updatedAt",
                content AS "resumeData"
         FROM base_resumes WHERE id = $1`,
        [id]
      );
      if (row) return NextResponse.json({ success: true, data: normalizeRow(row) });

      return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
    }

    const rows = await query<any>(
      `SELECT id, created_at AS "createdAt", updated_at AS "updatedAt",
              job_description AS "jobDescription", company_name AS "companyName",
              skills, resume_data AS "resumeData", chat_history AS "chatHistory"
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
    const { jobDescription, companyName, skills, resumeData, chatHistory } = body;

    if (!resumeData) {
      return NextResponse.json({ success: false, error: "Missing resumeData" }, { status: 400 });
    }

    const row = await queryOne<any>(
      `INSERT INTO falood_saved_applications
         (job_description, company_name, skills, resume_data, chat_history)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, created_at AS "createdAt"`,
      [
        jobDescription || null,
        companyName || null,
        skills || [],
        JSON.stringify(resumeData),
        JSON.stringify(chatHistory || []),
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

    if (updates.length === 0) {
      return NextResponse.json({ success: false, error: "No fields to update" }, { status: 400 });
    }

    updates.push(`updated_at = NOW()`);

    const row = await queryOne<any>(
      `UPDATE falood_saved_applications
       SET ${updates.join(", ")}
       WHERE id = $${values.length + 1}
       RETURNING id, created_at AS "createdAt", updated_at AS "updatedAt",
                 job_description AS "jobDescription", company_name AS "companyName",
                 skills, resume_data AS "resumeData", chat_history AS "chatHistory"`,
      [...values, id]
    );

    if (row) {
      return NextResponse.json({ success: true, data: normalizeRow(row) });
    }

    // Fallback 1: Multi-agent application workflow resumes
    if ("resumeData" in body) {
      const arRow = await queryOne<any>(
        `UPDATE application_resume_versions
         SET resume_data = $1::jsonb, updated_at = NOW()
         WHERE id = $2
         RETURNING id, created_at AS "createdAt", updated_at AS "updatedAt",
                   resume_data AS "resumeData"`,
        [JSON.stringify(body.resumeData), id]
      );
      if (arRow) {
        return NextResponse.json({ success: true, data: normalizeRow(arRow) });
      }
    }

    // Fallback 2: Base resumes
    if ("resumeData" in body) {
      const brRow = await queryOne<any>(
        `UPDATE base_resumes
         SET content = $1::jsonb, updated_at = NOW()
         WHERE id = $2
         RETURNING id, created_at AS "createdAt", updated_at AS "updatedAt",
                   content AS "resumeData"`,
        [JSON.stringify(body.resumeData), id]
      );
      if (brRow) {
        return NextResponse.json({ success: true, data: normalizeRow(brRow) });
      }
    }

    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
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
