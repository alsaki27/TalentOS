// POST /api/falood/applications/from-source
// Bridges TalentOS's real resume data (an application_resume_versions row -
// AI-pipeline or manually tailored - or a base_resumes row) into a new
// falood_saved_applications row, so the Resumify-based chatbot studio
// (/falood/studio/tailor/[id]) has something real to load. That studio has
// no concept of candidates/applications/workflows - this is the only bridge
// between the two data models. See src/lib/falood/studioDocumentToResumeData.ts
// for the content-shape conversion.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/auth";
import { execute, queryOne } from "@/server/db/neon";
import { studioDocumentToResumeData } from "@/lib/falood/studioDocumentToResumeData";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const currentUser = await getCurrentUserContext();
  if (!currentUser) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const source: string = body.source;
  const id: string = body.id;
  if (!id || (source !== "application_resume_version" && source !== "base_resume")) {
    return NextResponse.json({ error: "source ('application_resume_version' | 'base_resume') and id are required" }, { status: 400 });
  }

  try {
    let content: any = null;
    let jobTitle = "";
    let companyName = "";
    let skills: string[] = [];
    let candidateId: string | null = null;

    if (source === "application_resume_version") {
      const row = await queryOne<{ content: any; job_title: string | null; job_company: string | null; candidate_id: string | null }>(
        `SELECT arv.content,
                j.title AS job_title,
                j.company AS job_company,
                COALESCE(arv.candidate_id, a.candidate_id) AS candidate_id
         FROM application_resume_versions arv
         LEFT JOIN applications a ON a.id = arv.application_id
         LEFT JOIN jobs j ON j.id = COALESCE(arv.job_id, a.job_id)
         WHERE arv.id = $1`,
        [id]
      );
      if (!row) return NextResponse.json({ error: "Application resume version not found" }, { status: 404 });
      content = row.content;
      jobTitle = row.job_title ?? "";
      companyName = row.job_company ?? "";
      candidateId = row.candidate_id;
    } else {
      const row = await queryOne<{ content: any; target_industry: string | null; candidate_id: string | null }>(
        `SELECT content, target_industry, candidate_id FROM base_resumes WHERE id = $1`,
        [id]
      );
      if (!row) return NextResponse.json({ error: "Base resume not found" }, { status: 404 });
      content = row.content;
      companyName = row.target_industry ?? "";
      candidateId = row.candidate_id;
    }

    const parsedContent = typeof content === "string" ? JSON.parse(content) : content;
    const resumeData = studioDocumentToResumeData(parsedContent);
    skills = resumeData.skills.mode === "simple" ? resumeData.skills.simple : resumeData.skills.categorized.flatMap((c) => c.skills);

    const sourceKey = `${source}:${id}`;
    
    // Check if a studio session already exists for this source resume
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM falood_saved_applications WHERE name = $1 LIMIT 1`,
      [sourceKey]
    );

    if (existing) {
      // A base-resume studio session is a bridge/cache, not the source of truth.
      // Refresh it when the canonical base resume changes so old dates or roles
      // cannot keep appearing in Falood after a manager edits the base resume.
      // Do not do this for application_resume_version sessions: those are
      // job-specific historical snapshots and must remain immutable here.
      if (source === "base_resume") {
        await execute(
          `UPDATE falood_saved_applications
              SET company_name = $1,
                  skills = $2,
                  resume_data = $3,
                  updated_at = NOW()
            WHERE id = $4`,
          [companyName || null, skills, JSON.stringify(resumeData), existing.id]
        );
      }
      return NextResponse.json({ id: existing.id, jobTitle, companyName }, { status: 200 });
    }

    const created = await queryOne<{ id: string }>(
      `INSERT INTO falood_saved_applications
         (name, job_description, company_name, skills, resume_data, chat_history, candidate_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [sourceKey, jobTitle || null, companyName || null, skills, JSON.stringify(resumeData), JSON.stringify([]), candidateId]
    );
    if (!created) throw new Error("Failed to create falood_saved_applications row");

    return NextResponse.json({ id: created.id, jobTitle, companyName }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}
