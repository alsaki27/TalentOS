import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { getActiveProviderAsync } from "@/lib/ai";
import { textOf } from "@/lib/ai/provider";
import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { query, queryOne } from "@/server/db/neon";
import { findCandidateById } from "@/server/repositories/candidatesRepository";
import { findJobById } from "@/server/repositories/jobsRepository";
import { upsertTargetJobByCandidateAndJob } from "@/server/repositories/targetJobsRepository";

export const dynamic = "force-dynamic";

function stripCodeFence(text: string) {
  return text.replace(/^```(?:markdown|md)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function jobDescription(job: any) {
  return [
    `Title: ${job.title}`,
    job.company ? `Company: ${job.company}` : null,
    job.location ? `Location: ${job.location}` : null,
    job.job_category ? `Category: ${job.job_category}` : null,
    job.description_text,
    job.notes ? `Internal notes: ${job.notes}` : null,
  ].filter(Boolean).join("\n\n");
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const active = await getActiveProviderAsync();
  if (!active) {
    return NextResponse.json(
      { error: "AI provider is not configured. Set ANTHROPIC_API_KEY, NVIDIA_API_KEY, or GOOGLE_API_KEY, then try again." },
      { status: 503 },
    );
  }

  const body = await req.json();
  const candidateId = body.candidateId as string | undefined;
  const baseResumeId = body.baseResumeId as string | undefined;
  const jobId = body.jobId as string | undefined;

  if (!candidateId || !baseResumeId || !jobId) {
    return NextResponse.json({ error: "candidateId, baseResumeId, and jobId are required." }, { status: 400 });
  }

  const [candidate, baseResume, job, evidence] = await Promise.all([
    findCandidateById(candidateId),
    isNeon()
      ? queryOne<any>("SELECT * FROM base_resumes WHERE id = $1 AND candidate_id = $2", [baseResumeId, candidateId])
      : supabase.from("base_resumes").select("*").eq("id", baseResumeId).eq("candidate_id", candidateId).single().then((r: { data: any }) => r.data ?? null),
    findJobById(jobId),
    isNeon()
      ? query<{ title: string; description: string | null; related_skills: string[] | null; confidence_score: number | null }>(
          "SELECT title, description, related_skills, confidence_score FROM candidate_evidence WHERE candidate_id = $1 ORDER BY created_at DESC LIMIT 50",
          [candidateId]
        )
      : supabase.from("candidate_evidence").select("title, description, related_skills, confidence_score").eq("candidate_id", candidateId).order("created_at", { ascending: false }).limit(50).then((r: { data: any }) => r.data ?? []),
  ]);

  if (!candidate) return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
  if (!baseResume) return NextResponse.json({ error: "Source resume not found for this candidate." }, { status: 404 });
  if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });

  const rawDescription = jobDescription(job);
  if (!rawDescription.trim()) {
    return NextResponse.json({ error: "This job does not have enough description text to tailor against." }, { status: 400 });
  }

  const targetJob = await upsertTargetJobByCandidateAndJob(
    candidateId,
    jobId,
    {
      raw_description: rawDescription,
      created_by: context!.profile.user_id,
    }
  );

  if (!targetJob) {
    return NextResponse.json({ error: "Could not prepare target job." }, { status: 500 });
  }

  const prompt = `Create a tailored resume draft in Markdown.

Rules:
- Do not invent experience, employers, degrees, dates, tools, metrics, certifications, clearance, work authorization, or responsibilities.
- Use only facts present in the source resume, candidate profile, or evidence bank below.
- You may reorder, emphasize, and rewrite existing facts to match the job.
- If an important job requirement is not supported by the candidate facts, omit it.
- Keep the resume ATS-friendly. No tables. No images. No fake claims.
- Include a short HTML comment at the end named "truth_check" listing any requirements you intentionally did not claim because evidence was missing.
- Return only Markdown.

Candidate profile:
${JSON.stringify({
  name: candidate.name,
  email: candidate.email,
  phone: candidate.phone,
  target_roles: candidate.target_roles,
  preferred_locations: (candidate as any).preferred_locations,
  work_authorization: candidate.work_authorization,
  linkedin_url: candidate.linkedin_url,
  github_url: candidate.github_url,
  portfolio_url: candidate.portfolio_url,
}, null, 2)}

Source resume JSON:
${JSON.stringify(baseResume.content, null, 2)}

Evidence bank:
${JSON.stringify(evidence ?? [], null, 2)}

Target job:
${rawDescription}`;

  try {
    const aiResponse = await active.provider.send({
      system: "You are a careful resume editor. You tailor resumes without inventing facts.",
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      tools: [],
    });
    const draft = stripCodeFence(textOf(aiResponse.content));
    if (!draft) return NextResponse.json({ error: "AI provider returned an empty draft." }, { status: 502 });

    return NextResponse.json({
      draft,
      targetJobId: targetJob.id,
      title: `${candidate.name} - ${job.title}`,
      versionLabel: `${job.company || "Job"} tailored draft`,
      provider: active.name,
      warning: "Review before sending.",
    });
  } catch {
    return NextResponse.json({ error: "AI resume tailoring failed. Check provider configuration and try again." }, { status: 502 });
  }
}
