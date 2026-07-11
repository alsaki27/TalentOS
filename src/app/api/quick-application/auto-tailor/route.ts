// src/app/api/quick-application/auto-tailor/route.ts
// Auto-generates an ATS-friendly tailored resume from a base resume + JD.
// Called automatically after an application is logged from the Jobs tab
// when a base resume is selected.
//
// Flow mirrors TailorResumeModal.tsx:
// 1. Fetch base resume content + job details
// 2. Convert base resume to ResumeData format
// 3. Send to AI for tailoring
// 4. Save to falood_saved_applications via POST /api/falood/applications
// 5. Return the falood app ID so the frontend can link to /falood/studio/tailor/{id}

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { isNeon } from "@/server/db";
import { queryOne } from "@/server/db/neon";
import { findJobById } from "@/server/repositories/jobsRepository";
import { getProviderForCategory } from "@/lib/ai";
import { textOf } from "@/lib/ai/provider";
import { DEFAULT_COLORS, DEFAULT_PAGE_PADDING, DEFAULT_SECTIONS, type ResumeData } from "@/components/falood/resumify/types/resume";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function formatJobDescription(job: any): string {
  return [
    `Title: ${job.title ?? ""}`,
    job.company ? `Company: ${job.company}` : null,
    job.location ? `Location: ${job.location}` : null,
    job.job_category ? `Category: ${job.job_category}` : null,
    job.description_text ? job.description_text : null,
    job.notes ? `Internal notes: ${job.notes}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function stripCodeFence(text: string) {
  return text
    .replace(/^```(?:json|markdown|md)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

/** Convert old base-resume JSON format to the ResumeData format used by the builder */
function convertOldFormatToNew(old: any): ResumeData {
  if (!old || typeof old !== "object") {
    return {
      personalInfo: {
        fullName: "", jobTitle: "", email: "", phone: "",
        location: "", website: "", linkedin: "", github: "",
        profileImage: "", birthDate: "",
      },
      summary: "",
      experience: [],
      education: [],
      projects: [],
      skills: { mode: "simple", simple: [], categorized: [] },
      customSections: [],
      sections: DEFAULT_SECTIONS,
      colors: DEFAULT_COLORS,
      template: "business-professional",
      pageFormat: "letter",
      fontSize: "medium",
      fontFamily: "Inter",
      pagePadding: DEFAULT_PAGE_PADDING,
    };
  }

  // Already in new format
  if (old.personalInfo) return old as ResumeData;

  // Convert from old header/experience/etc format
  const customSections: ResumeData["customSections"] = [];
  if (Array.isArray(old.customSections)) {
    for (let i = 0; i < old.customSections.length; i++) {
      const section = old.customSections[i];
      const content = Array.isArray(section?.bullets)
        ? section.bullets.map((b: any) => b?.text || b).filter(Boolean).join("\n")
        : typeof section?.content === "string" ? section.content.trim() : "";
      if (!content) continue;
      const lines = content.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean);
      customSections.push({
        id: section?.id || `custom-${i}`,
        title: section?.title || `Custom Section ${i + 1}`,
        content,
        type: lines.length > 1 ? "bullets" : "paragraph",
        visible: section?.visible ?? true,
        order: i,
        placement: section?.placement || "right",
      });
    }
  }
  if (Array.isArray(old.certifications) && old.certifications.length > 0) {
    const certLines = old.certifications
      .map((c: any) => [c?.name, c?.issuer, c?.date].filter(Boolean).join(" | "))
      .filter(Boolean);
    if (certLines.length > 0) {
      customSections.push({
        id: "certifications", title: "Certifications", content: certLines.join("\n"),
        type: "bullets", visible: true, order: customSections.length, placement: "right",
      });
    }
  }

  return {
    personalInfo: {
      fullName: old.header?.fullName || "",
      jobTitle: "",
      email: old.header?.email || "",
      phone: old.header?.phone || "",
      location: old.header?.location || "",
      website: old.header?.portfolio || old.header?.website || "",
      linkedin: old.header?.linkedin || "",
      github: old.header?.github || "",
      profileImage: "",
      birthDate: "",
    },
    summary: old.summary?.text || "",
    experience: Array.isArray(old.experience)
      ? old.experience.map((e: any) => ({
          id: e.id || Math.random().toString(),
          jobTitle: e.title || "",
          company: e.company || "",
          location: e.location || "",
          startDate: e.startDate || "",
          endDate: e.endDate || "",
          current: !e.endDate,
          description: "",
          bulletPoints: Array.isArray(e.bullets) ? e.bullets.map((b: any) => b.text || b) : [],
        }))
      : [],
    education: Array.isArray(old.education)
      ? old.education.map((e: any) => ({
          id: e.id || Math.random().toString(),
          degree: e.degree || "",
          institution: e.school || "",
          location: "",
          graduationYear: e.graduationDate || "",
        }))
      : [],
    skills: {
      mode: "categorized",
      simple: [],
      categorized: Array.isArray(old.skills)
        ? old.skills.map((s: any) => ({
            id: s.id || Math.random().toString(),
            name: s.title || "",
            skills: Array.isArray(s.skills) ? s.skills : [],
          }))
        : [],
    },
    projects: Array.isArray(old.projects)
      ? old.projects.map((p: any) => ({
          id: p.id || Math.random().toString(),
          title: p.title || p.name || "",
          description:
            p.description ||
            (Array.isArray(p.bullets) ? p.bullets.map((b: any) => b?.text || b).filter(Boolean).join("\n") : "") ||
            "",
          technologies: Array.isArray(p.technologies) ? p.technologies.filter(Boolean) : [],
          liveUrl: p.liveUrl || p.url || "",
          githubUrl: "",
        }))
      : [],
    customSections,
    sections: DEFAULT_SECTIONS,
    colors: DEFAULT_COLORS,
    template: "business-professional",
    pageFormat: "letter",
    fontSize: "medium",
    fontFamily: "Inter",
    pagePadding: DEFAULT_PAGE_PADDING,
  };
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const body = await req.json();
  const candidateId = body.candidateId as string | undefined;
  const jobId = body.jobId as string | undefined;
  const applicationId = body.applicationId as string | undefined;
  const baseResumeId = body.baseResumeId as string | undefined;

  if (!candidateId || !jobId || !applicationId || !baseResumeId) {
    return NextResponse.json(
      { error: "candidateId, jobId, applicationId, and baseResumeId are required." },
      { status: 400 }
    );
  }

  /* ── 1. Check AI provider availability ── */
  const active = await getProviderForCategory("resume_studio");
  if (!active) {
    return NextResponse.json(
      { error: "No AI provider configured for resume_studio. Configure one in Settings → AI." },
      { status: 503 }
    );
  }

  /* ── 2. Fetch base resume + job ── */
  let baseResume: any;
  if (isNeon()) {
    baseResume = await queryOne<any>(
      "SELECT id, name, content FROM base_resumes WHERE id = $1 AND candidate_id = $2",
      [baseResumeId, candidateId]
    );
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("base_resumes")
      .select("id, name, content")
      .eq("id", baseResumeId)
      .eq("candidate_id", candidateId)
      .single();
    baseResume = res.data;
  }

  if (!baseResume?.content) {
    return NextResponse.json({ error: "Base resume not found or has no content." }, { status: 404 });
  }

  const job = await findJobById(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  /* ── 3. Convert base resume content to ResumeData format ── */
  const resumeData = convertOldFormatToNew(baseResume.content);
  const jd = formatJobDescription(job);

  /* ── 4. Call AI to tailor the resume ── */
  const prompt = `You are an ATS resume optimization expert. Given the following resume data and job description, tailor the resume to maximize ATS compatibility for this specific role.

RULES:
- Do NOT fabricate experience, skills, certifications, or metrics the candidate doesn't have.
- You MAY reorder sections, rephrase bullets, adjust emphasis, and highlight relevant skills.
- Do NOT add extra sections or fields (like Professional Summary, Job Title, etc.) if they are empty or missing in the provided base resume. Only update and tailor what is already there.
- Output MUST be a valid JSON object matching the exact ResumeData structure provided.
- Do NOT include any commentary, markdown, or code fences. Just the JSON.

Current resume data:
${JSON.stringify(resumeData, null, 2)}

Target job description:
${jd}`;

  let tailoredResumeData: ResumeData;
  try {
    const aiResponse = await active.provider.send({
      system:
        "You are an expert ATS resume optimizer. You tailor resumes to specific jobs without inventing facts. Respond with ONLY a valid JSON object matching the ResumeData interface, no markdown, no commentary.",
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      tools: [],
    });
    const raw = stripCodeFence(textOf(aiResponse.content));
    if (!raw) {
      // Fallback: use the original resume data as-is
      tailoredResumeData = resumeData;
    } else {
      const parsed = JSON.parse(raw);
      // Ensure it has personalInfo (basic validation)
      if (parsed.personalInfo) {
        tailoredResumeData = {
          ...resumeData,
          ...parsed,
          // Preserve formatting settings from original
          sections: parsed.sections || resumeData.sections,
          colors: parsed.colors || resumeData.colors,
          template: parsed.template || resumeData.template,
          pageFormat: parsed.pageFormat || resumeData.pageFormat,
          fontSize: parsed.fontSize || resumeData.fontSize,
          fontFamily: parsed.fontFamily || resumeData.fontFamily,
          pagePadding: parsed.pagePadding || resumeData.pagePadding,
        };
      } else {
        // AI returned something weird, use original
        tailoredResumeData = resumeData;
      }
    }
  } catch (parseErr: any) {
    // If AI/parse fails, fall back to using the base resume as-is
    tailoredResumeData = resumeData;
  }

  /* ── 5. Save to falood_saved_applications (same as TailorResumeModal) ── */
  let faloodAppId: string;
  try {
    const createRes = await queryOne<any>(
      `INSERT INTO falood_saved_applications
         (job_description, company_name, skills, resume_data, chat_history)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        jd,
        job.company || null,
        [],
        JSON.stringify(tailoredResumeData),
        JSON.stringify([
          { id: "meta-candidate", role: "assistant", content: "", candidateId, candidateName: resumeData.personalInfo.fullName },
          { id: "auto-tailor-note", role: "assistant", content: `Auto-tailored from base resume "${baseResume.name}" for "${job.title}"` },
        ]),
      ]
    );

    if (!createRes?.id) {
      return NextResponse.json({ error: "Failed to save tailored resume." }, { status: 500 });
    }
    faloodAppId = createRes.id;
  } catch (err: any) {
    return NextResponse.json({ error: "Failed to save tailored resume: " + err.message }, { status: 500 });
  }

  return NextResponse.json({
    faloodAppId,
    jobTitle: job.title || "",
    company: job.company || "",
    status: "complete",
  });
}
