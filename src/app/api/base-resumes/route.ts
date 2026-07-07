// src/app/api/base-resumes/route.ts
// GET  -> list base resumes for a candidate (?candidateId=)
// POST -> create a new base resume. Starting source determines initial content:
//   "blank" -> empty skeleton from candidate contact info
//   "uploaded_resume" -> skeleton seeded with the candidate's parsed original resume
//     (skills/experience/education copied in, ready for /create-base to refine)
//   duplicate of an existing base resume -> pass sourceBaseResumeId instead

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { query, queryOne, execute } from "@/server/db/neon";
import { logActivity } from "@/lib/activity";
import { buildSkeletonDocument } from "@/lib/ai/faloodBaseResume";
import { ResumeDocument } from "@/lib/falood/types";
import { buildResumeDocumentFromParsedResume } from "@/lib/falood/seedFromParsedResume";
import { downloadFromSharePoint } from "@/lib/integrations/sharepoint";
import { extractText, parseResumeFields, parseResumeTextWithProvider } from "@/lib/resumeParsing";
import { getOpenAiProvider } from "@/lib/ai/openaiProvider";

// #region debug-point A:base-resume-seeding-debug
function reportBaseResumeSeedingDebug(
  hypothesisId: "A" | "B" | "C" | "D" | "E",
  msg: string,
  data: Record<string, unknown> = {}
) {
  fetch("http://127.0.0.1:7777/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "base-resume-load-loop",
      runId: "pre-fix",
      hypothesisId,
      location: "src/app/api/base-resumes/route.ts",
      msg: `[DEBUG] ${msg}`,
      data,
      ts: Date.now(),
    }),
  }).catch(() => {});
}

function logBaseResumeCreateConsole(step: string, data: Record<string, unknown> = {}) {
  console.log(`[BASE_RESUME_CREATE] ${step}`, data);
}
// #endregion

function guessMimeType(filename: string, contentType?: string | null): string {
  if (contentType && contentType !== "application/octet-stream") return contentType;
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}

async function loadLatestUploadedResume(candidateId: string) {
  if (isNeon()) {
    return queryOne<{
      id: string;
      filename: string;
      file_url: string;
      parsed_json: any | null;
      is_original_upload: boolean;
    }>(
      `SELECT id, filename, file_url, parsed_json, is_original_upload
       FROM resumes
       WHERE candidate_id = $1 AND kind = 'resume'
       ORDER BY is_original_upload DESC, created_at DESC
       LIMIT 1`,
      [candidateId]
    );
  }

  const res = await supabase
    .from("resumes")
    .select("id, filename, file_url, parsed_json, is_original_upload")
    .eq("candidate_id", candidateId)
    .eq("kind", "resume")
    .order("is_original_upload", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return res.data;
}

async function updateParsedResume(resumeId: string, parsed: any) {
  if (isNeon()) {
    await execute("UPDATE resumes SET parsed_json = $1 WHERE id = $2", [parsed, resumeId]);
    return;
  }
  await supabase.from("resumes").update({ parsed_json: parsed }).eq("id", resumeId);
}

async function parseUploadedResumeForBaseSeeding(resume: { id: string; filename: string; file_url: string }) {
  let buffer: Uint8Array;
  let contentType: string | null = null;

  // #region debug-point A:base-seeding-start
  reportBaseResumeSeedingDebug("A", "base resume seeding started from uploaded resume", {
    resumeId: resume.id,
    filename: resume.filename,
    fileUrl: resume.file_url,
  });
  // #endregion
  logBaseResumeCreateConsole("uploaded resume seeding started", {
    resumeId: resume.id,
    filename: resume.filename,
    fileUrl: resume.file_url,
  });

  if (resume.file_url.includes("sharepoint.com")) {
    const result = await downloadFromSharePoint(resume.file_url);
    buffer = result.buffer;
    contentType = result.contentType;
  } else {
    const fileRes = await fetch(resume.file_url);
    if (!fileRes.ok) throw new Error(`Failed to download uploaded resume (${fileRes.status})`);
    buffer = new Uint8Array(await fileRes.arrayBuffer());
    contentType = fileRes.headers.get("content-type");
  }

  const rawText = (await extractText(buffer, guessMimeType(resume.filename, contentType))).trim();
  // #region debug-point A:base-seeding-raw-text
  reportBaseResumeSeedingDebug("A", "uploaded resume text extracted for base seeding", {
    resumeId: resume.id,
    filename: resume.filename,
    contentType,
    rawTextLength: rawText.length,
    rawText,
  });
  // #endregion
  logBaseResumeCreateConsole("raw text extracted from uploaded resume", {
    resumeId: resume.id,
    filename: resume.filename,
    contentType,
    rawTextLength: rawText.length,
    rawText,
  });
  if (rawText.length < 50) {
    throw new Error("We found an uploaded resume, but couldn't extract enough readable text. Please upload a text-based PDF/DOCX or paste the resume text first.");
  }

  const openAiProvider = getOpenAiProvider();
  logBaseResumeCreateConsole("starting structured parsing for uploaded resume", {
    resumeId: resume.id,
    provider: openAiProvider ? "openaiProvider" : "categoryProvider",
  });
  const parsed = openAiProvider
    ? await parseResumeTextWithProvider(rawText, openAiProvider)
    : await parseResumeFields(rawText);

  // #region debug-point C:base-seeding-parsed-result
  reportBaseResumeSeedingDebug("C", "uploaded resume parsed for base seeding", {
    resumeId: resume.id,
    rawTextLength: rawText.length,
    parsedSkills: parsed.skills,
    experienceCount: parsed.experience.length,
    educationCount: parsed.education.length,
    certificationsCount: parsed.certifications.length,
    summary: parsed.summary ?? null,
  });
  // #endregion
  logBaseResumeCreateConsole("uploaded resume parsed into structured json", {
    resumeId: resume.id,
    parsedJson: parsed,
  });

  if (
    !parsed.summary &&
    !parsed.skills.length &&
    !parsed.experience.length &&
    !parsed.education.length &&
    !parsed.certifications.length
  ) {
    throw new Error("We found an uploaded resume, but the parser couldn't extract structured resume data from it.");
  }

  await updateParsedResume(resume.id, parsed);
  // #region debug-point D:base-seeding-parsed-saved
  reportBaseResumeSeedingDebug("D", "parsed resume saved for base seeding", {
    resumeId: resume.id,
    parsedSkills: parsed.skills,
  });
  // #endregion
  logBaseResumeCreateConsole("parsed resume json saved to resumes table", {
    resumeId: resume.id,
    parsedJson: parsed,
  });
  return parsed;
}

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const candidateId = new URL(req.url).searchParams.get("candidateId");
  if (!candidateId) return NextResponse.json({ error: "candidateId is required" }, { status: 400 });

  let data: any[];
  let error: any;

  if (isNeon()) {
    data = await query(
      'SELECT id, name, target_industry, target_roles, style_id, status, created_at, updated_at FROM base_resumes WHERE candidate_id = $1 ORDER BY created_at DESC',
      [candidateId]
    );
    error = null;
  } else {
    const res = await supabase
      .from("base_resumes")
      .select("id, name, target_industry, target_roles, style_id, status, created_at, updated_at")
      .eq("candidate_id", candidateId)
      .order("created_at", { ascending: false });
    data = res.data ?? [];
    error = res.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  try {
    const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
    if (response) return response;

    const body = await req.json();
    const candidateId = body.candidateId as string | undefined;
    const name = (body.name as string | undefined)?.trim();
    const targetIndustry = body.targetIndustry as string | undefined;
    const targetRoles = (body.targetRoles as string[] | undefined) ?? [];
    const styleId = (body.styleId as string | undefined) || "skarion_compact_professional";
    const startingSource = (body.startingSource as string | undefined) || "blank";
    const sourceBaseResumeId = body.sourceBaseResumeId as string | undefined;

    // #region debug-point A:base-resume-post-start
    reportBaseResumeSeedingDebug("A", "base resume POST received", {
      candidateId,
      name,
      startingSource,
      sourceBaseResumeId: sourceBaseResumeId ?? null,
      styleId,
    });
    // #endregion
    logBaseResumeCreateConsole("base resume POST received", {
      candidateId,
      name,
      startingSource,
      sourceBaseResumeId: sourceBaseResumeId ?? null,
      styleId,
    });

    if (!candidateId || !name) {
      return NextResponse.json({ error: "candidateId and name are required" }, { status: 400 });
    }

    let candidate: any;
    let candidateError: any;

    if (isNeon()) {
      candidate = await queryOne(
        'SELECT id, name, email, phone, linkedin_url, github_url, portfolio_url FROM candidates WHERE id = $1',
        [candidateId]
      );
      candidateError = candidate ? null : { message: 'Candidate not found' };
    } else {
      const res = await supabase
        .from("candidates")
        .select("id, name, email, phone, linkedin_url, github_url, portfolio_url")
        .eq("id", candidateId)
        .single();
      candidate = res.data;
      candidateError = res.error;
    }

    if (candidateError || !candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

    let style: any;
    if (isNeon()) {
      style = await queryOne(
        'SELECT id, formatting_defaults FROM resume_styles WHERE id = $1',
        [styleId]
      );
    } else {
      const res = await supabase.from("resume_styles").select("id, formatting_defaults").eq("id", styleId).single();
      style = res.data;
    }
    const formatting = style ? { styleId, ...(style.formatting_defaults ?? {}) } : { styleId };
    const effectiveStyleId = style ? styleId : null;

    let content: ResumeDocument;

    if (startingSource === "duplicate" && sourceBaseResumeId) {
      let source: any;
      if (isNeon()) {
        source = await queryOne(
          'SELECT content FROM base_resumes WHERE id = $1',
          [sourceBaseResumeId]
        );
      } else {
        const res = await supabase.from("base_resumes").select("content").eq("id", sourceBaseResumeId).single();
        source = res.data;
      }
      content = source?.content ?? buildSkeletonDocument(candidate, formatting);
      // #region debug-point D:base-resume-duplicate-source
      reportBaseResumeSeedingDebug("D", "base resume duplicated from existing resume", {
        candidateId,
        sourceBaseResumeId,
        sourceSkills: source?.content?.skills ?? null,
        sourceSummary: source?.content?.summary ?? null,
        sourceExperienceCount: Array.isArray(source?.content?.experience) ? source.content.experience.length : 0,
        sourceEducationCount: Array.isArray(source?.content?.education) ? source.content.education.length : 0,
        duplicatedSkills: content?.skills ?? null,
      });
      // #endregion
    } else if (startingSource === "uploaded_resume") {
      const uploadedResume = await loadLatestUploadedResume(candidateId);
      if (!uploadedResume) {
        return NextResponse.json(
          { error: "Please upload a resume first before choosing 'Seed from uploaded resume'." },
          { status: 400 }
        );
      }
      const parsed = await parseUploadedResumeForBaseSeeding(uploadedResume);
      content = buildResumeDocumentFromParsedResume(parsed as typeof parsed & Record<string, unknown>, candidate, formatting);
      // #region debug-point D:base-resume-content-built
      reportBaseResumeSeedingDebug("D", "base resume content built from uploaded parsed resume", {
        candidateId,
        parsedSkills: parsed.skills,
        builderSkillSections: content.skills,
      });
      // #endregion
      logBaseResumeCreateConsole("base resume content built from parsed upload", {
        candidateId,
        parsedJson: parsed,
        builderSkillSections: content.skills,
      });
    } else {
      content = buildSkeletonDocument(candidate, formatting);
    }

    let data: any;
    let error: any;

    if (isNeon()) {
      const contentJson = JSON.stringify(content);
      data = await queryOne(
        `INSERT INTO base_resumes (candidate_id, name, target_industry, target_roles, style_id, content, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8) RETURNING *`,
        [candidateId, name, targetIndustry ?? null, targetRoles, effectiveStyleId, contentJson, context!.profile.user_id, context!.profile.user_id]
      );
      error = data ? null : { message: 'Insert failed' };
    } else {
      const res = await supabase
        .from("base_resumes")
        .insert({
          candidate_id: candidateId,
          name,
          target_industry: targetIndustry ?? null,
          target_roles: targetRoles,
          style_id: effectiveStyleId,
          content,
          created_by: context!.profile.user_id,
          updated_by: context!.profile.user_id,
        })
        .select()
        .single();
      data = res.data;
      error = res.error;
    }

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Invalidate match scores for this candidate since they have a new base resume
    if (isNeon()) {
      await execute('DELETE FROM job_match_scores WHERE candidate_id = $1', [candidateId]);
    } else {
      await supabase.from("job_match_scores").delete().eq("candidate_id", candidateId);
    }

    await logActivity({
      userId: context!.profile.user_id,
      actorName: context!.profile.display_name || context!.profile.email || "",
      type: "create",
      description: `Created base resume "${name}" for candidate`,
      entityType: "base_resume",
      entityId: data.id,
      entityName: name,
      metadata: { candidate_id: candidateId, starting_source: startingSource },
    });

    return NextResponse.json(data, { status: 201 });
  } catch (err: any) {
    console.error("POST /api/base-resumes error:", err);
    return NextResponse.json({ error: err.message ?? "Unknown error creating base resume" }, { status: 500 });
  }
}
