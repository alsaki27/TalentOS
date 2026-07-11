// src/app/api/quick-application/auto-tailor/route.ts
// Auto-generates an ATS-friendly tailored resume from a base resume + JD.
// Called automatically after an application is created via Quick Application
// when a base resume is selected. Creates an application_resume_version with
// the AI-tailored content and links it to the application via application_packets.

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { isNeon } from "@/server/db";
import { query, queryOne, execute } from "@/server/db/neon";
import { findCandidateById } from "@/server/repositories/candidatesRepository";
import { findJobById } from "@/server/repositories/jobsRepository";
import { upsertTargetJobByCandidateAndJob } from "@/server/repositories/targetJobsRepository";
import { getProviderForCategory } from "@/lib/ai";
import { textOf } from "@/lib/ai/provider";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";
// AI resume generation can take a while
export const maxDuration = 60;

function jobDescription(job: any): string {
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
      { error: "AI provider is not configured. Auto-tailoring skipped." },
      { status: 503 }
    );
  }

  /* ── 2. Fetch base resume, job, candidate, and evidence ── */
  let baseResume: any;
  if (isNeon()) {
    baseResume = await queryOne(
      `SELECT content, candidate_id FROM base_resumes WHERE id = $1`,
      [baseResumeId]
    );
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("base_resumes")
      .select("content, candidate_id")
      .eq("id", baseResumeId)
      .single();
    baseResume = res.data;
  }

  if (!baseResume) {
    return NextResponse.json({ error: "Base resume not found." }, { status: 404 });
  }

  const [candidate, job, evidence] = await Promise.all([
    findCandidateById(candidateId),
    findJobById(jobId),
    isNeon()
      ? query<{ title: string; description: string | null; related_skills: string[] | null }>(
          "SELECT title, description, related_skills FROM candidate_evidence WHERE candidate_id = $1 ORDER BY created_at DESC LIMIT 50",
          [candidateId]
        )
      : import("@/lib/supabase").then(({ supabase }) =>
          supabase
            .from("candidate_evidence")
            .select("title, description, related_skills")
            .eq("candidate_id", candidateId)
            .order("created_at", { ascending: false })
            .limit(50)
            .then((r: { data: any }) => r.data ?? [])
        ),
  ]);

  if (!candidate) return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  const rawDescription = jobDescription(job);
  if (!rawDescription.trim()) {
    return NextResponse.json(
      { error: "Job does not have enough description text to tailor against." },
      { status: 400 }
    );
  }

  /* ── 3. Upsert target_job ── */
  const targetJob = await upsertTargetJobByCandidateAndJob(candidateId, jobId, {
    raw_description: rawDescription,
    created_by: context!.profile.user_id,
  });

  if (!targetJob) {
    return NextResponse.json({ error: "Could not prepare target job." }, { status: 500 });
  }

  const targetJobId = targetJob.id as string;

  /* ── 4. Call AI to generate tailored resume ── */
  const prompt = `You are an expert ATS resume optimizer. Given a source resume and a target job description, produce a tailored resume as a JSON object.

CRITICAL RULES:
- Do NOT invent experience, employers, degrees, dates, tools, metrics, certifications, clearance, work authorization, or responsibilities.
- Use ONLY facts present in the source resume, candidate profile, or evidence bank below.
- You may reorder, emphasize, rephrase, and restructure existing facts to best match the job requirements.
- Optimize for ATS (Applicant Tracking System) keyword matching — mirror exact keywords from the JD where truthfully supported.
- Keep the resume concise — aim for 1 page if possible.
- If an important job requirement is not supported by candidate facts, simply omit it. Never fabricate.

Return a JSON object with this EXACT structure (no markdown fences, no commentary, ONLY the JSON object):
{
  "header": {
    "fullName": "string",
    "email": "string",
    "phone": "string",
    "location": "string",
    "linkedin": "string or empty",
    "github": "string or empty",
    "portfolio": "string or empty"
  },
  "summary": {
    "text": "A 2-3 sentence professional summary tailored to the target role"
  },
  "skills": [
    {
      "id": "unique-id",
      "title": "Category name (e.g. Programming Languages, Tools)",
      "skills": ["skill1", "skill2"]
    }
  ],
  "experience": [
    {
      "id": "unique-id",
      "title": "Job Title",
      "company": "Company Name",
      "location": "City, State",
      "startDate": "Mon YYYY",
      "endDate": "Mon YYYY or Present",
      "bullets": [
        { "id": "unique-id", "text": "Achievement-oriented bullet point with metrics where available", "riskLevel": "low" }
      ]
    }
  ],
  "education": [
    {
      "id": "unique-id",
      "degree": "Degree Name",
      "school": "School Name",
      "graduationDate": "YYYY"
    }
  ],
  "certifications": [
    {
      "name": "Certification Name",
      "issuer": "Issuing Body",
      "date": "YYYY"
    }
  ],
  "customSections": [],
  "formatting": {
    "styleId": "skarion_compact_professional",
    "pageFormat": "letter",
    "fontFamily": "Calibri",
    "fontSize": 10.5,
    "marginTop": 0.5,
    "marginRight": 0.5,
    "marginBottom": 0.5,
    "marginLeft": 0.5,
    "sectionSpacing": 8,
    "bulletSpacing": 2,
    "lineHeight": 1.15
  }
}

Candidate profile:
${JSON.stringify(
  {
    name: candidate.name,
    email: candidate.email,
    phone: candidate.phone,
    target_roles: candidate.target_roles,
    preferred_locations: (candidate as any).preferred_locations,
    work_authorization: candidate.work_authorization,
    linkedin_url: candidate.linkedin_url,
    github_url: candidate.github_url,
    portfolio_url: candidate.portfolio_url,
  },
  null,
  2
)}

Source resume content:
${JSON.stringify(baseResume.content, null, 2)}

Evidence bank (verified candidate facts):
${JSON.stringify(evidence ?? [], null, 2)}

Target job description:
${rawDescription}`;

  let tailoredContent: any;
  let generatedText: string = "";
  try {
    const aiResponse = await active.provider.send({
      system:
        "You are an expert ATS resume optimizer. You tailor resumes to specific jobs without inventing facts. Respond with ONLY a valid JSON object, no markdown, no commentary.",
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      tools: [],
    });
    const raw = stripCodeFence(textOf(aiResponse.content));
    if (!raw) {
      return NextResponse.json({ error: "AI provider returned an empty response." }, { status: 502 });
    }

    generatedText = raw;
    tailoredContent = JSON.parse(raw);
  } catch (parseErr: any) {
    // If JSON parsing fails, store it as generated_text only and use base resume content as fallback
    if (generatedText) {
      tailoredContent = baseResume.content;
    } else {
      return NextResponse.json(
        { error: "AI resume tailoring failed. " + (parseErr.message ?? "") },
        { status: 502 }
      );
    }
  }

  /* ── 5. Insert application_resume_version ── */
  const title = `${candidate.name} — ${job.title} (Auto-Tailored)`;
  const versionLabel = `${job.company || "Job"} ATS-tailored draft`;

  let version: any;
  if (isNeon()) {
    const contentJson = JSON.stringify(tailoredContent);
    version = await queryOne(
      `INSERT INTO application_resume_versions
        (candidate_id, base_resume_id, target_job_id, content, status, source_type, created_by, source_resume_id, title, version_label, generated_text)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        candidateId,
        baseResumeId,
        targetJobId,
        contentJson,
        "draft",
        "base_resume",
        context!.profile.user_id,
        baseResumeId,
        title,
        versionLabel,
        generatedText || null,
      ]
    );
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("application_resume_versions")
      .insert({
        candidate_id: candidateId,
        base_resume_id: baseResumeId,
        target_job_id: targetJobId,
        content: tailoredContent,
        status: "draft",
        source_type: "base_resume",
        created_by: context!.profile.user_id,
        source_resume_id: baseResumeId,
        title,
        version_label: versionLabel,
        generated_text: generatedText || null,
      })
      .select()
      .single();
    version = res.data;
    if (res.error) {
      return NextResponse.json({ error: res.error.message }, { status: 500 });
    }
  }

  if (!version) {
    return NextResponse.json(
      { error: "Failed to create tailored resume version." },
      { status: 500 }
    );
  }

  /* ── 6. Upsert application_packet to link version → application ── */
  let packetId: string | null = null;
  try {
    if (isNeon()) {
      // Write to both resume_version_id (used by falood-setup) and final_resume_version_id
      // (used by application-packets route) — the live schema may have one or both columns.
      await execute(
        `INSERT INTO application_packets (application_id, resume_version_id, final_resume_version_id, updated_at)
         VALUES ($1, $2, $2, NOW())
         ON CONFLICT (application_id) DO UPDATE
           SET resume_version_id = EXCLUDED.resume_version_id,
               final_resume_version_id = EXCLUDED.final_resume_version_id,
               updated_at = NOW()`,
        [applicationId, version.id]
      );
      packetId = applicationId;
    } else {
      const { supabase } = await import("@/lib/supabase");
      const res = await supabase
        .from("application_packets")
        .upsert(
          {
            application_id: applicationId,
            resume_version_id: version.id,
            final_resume_version_id: version.id,
          },
          { onConflict: "application_id" }
        )
        .select()
        .single();
      if (res.data) packetId = res.data.application_id;
    }
  } catch (e: any) {
    // Non-fatal — the resume version is still created even if packet linking fails
    console.error("Failed to create/update application packet:", e);
  }

  /* ── 7. Log activity ── */
  await logActivity({
    userId: context!.profile.user_id,
    actorName: context!.profile.display_name || context!.profile.email || undefined,
    type: "create",
    description: `Auto-tailored resume for ${candidate.name} → ${job.title}`,
    entityType: "application_resume_version",
    entityId: version.id,
    entityName: title,
    metadata: {
      candidate_id: candidateId,
      job_id: jobId,
      application_id: applicationId,
      base_resume_id: baseResumeId,
      target_job_id: targetJobId,
      packet_id: packetId,
      auto_tailored: true,
    },
  });

  return NextResponse.json({
    versionId: version.id,
    targetJobId,
    packetId,
    title,
    status: "complete",
  });
}
