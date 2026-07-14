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
import { queryOne } from "@/server/db/neon";
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

    if (source === "application_resume_version") {
      const row = await queryOne<{ content: any; job_title: string | null; job_company: string | null }>(
        `SELECT arv.content,
                j.title AS job_title,
                j.company AS job_company
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
    } else {
      const row = await queryOne<{ content: any; target_industry: string | null }>(
        `SELECT content, target_industry FROM base_resumes WHERE id = $1`,
        [id]
      );
      if (!row) return NextResponse.json({ error: "Base resume not found" }, { status: 404 });
      content = row.content;
      companyName = row.target_industry ?? "";
    }

    const parsedContent = typeof content === "string" ? JSON.parse(content) : content;
    const resumeData = studioDocumentToResumeData(parsedContent);
    skills = resumeData.skills.mode === "simple" ? resumeData.skills.simple : resumeData.skills.categorized.flatMap((c) => c.skills);

    const created = await queryOne<{ id: string }>(
      `INSERT INTO falood_saved_applications
         (job_description, company_name, skills, resume_data, chat_history)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [jobTitle || null, companyName || null, JSON.stringify(skills), JSON.stringify(resumeData), JSON.stringify([])]
    );
    if (!created) throw new Error("Failed to create falood_saved_applications row");

    return NextResponse.json({ id: created.id, jobTitle, companyName }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? String(err) }, { status: 500 });
  }
}
