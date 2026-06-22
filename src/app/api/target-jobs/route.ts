// src/app/api/target-jobs/route.ts
// GET  -> list target jobs for a candidate (?candidateId=)
// POST -> create target job from pasted JD (AI analyzes and creates job_keywords)

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { query, execute } from "@/server/db/neon";
import { listTargetJobsByCandidate, createTargetJob } from "@/server/repositories/targetJobsRepository";
import { getActiveProviderAsync } from "@/lib/ai";
import { textOf } from "@/lib/ai/provider";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const candidateId = new URL(req.url).searchParams.get("candidateId");
  if (!candidateId) return NextResponse.json({ error: "candidateId is required" }, { status: 400 });

  const data = await listTargetJobsByCandidate(candidateId);
  return NextResponse.json(data ?? []);
}

const JD_ANALYSIS_PROMPT = `Analyze the job description below and extract structured information. Return ONLY raw JSON matching this exact schema (no markdown). Extract ONLY what is explicitly stated in the text - do not invent skills, tools, requirements, or company details that aren't there; use null or an empty array for anything not actually present.

{
  "title": string | null,
  "company": string | null,
  "location": string | null,
  "workplace_type": "remote" | "hybrid" | "onsite" | "unknown",
  "requiredSkills": string[],
  "preferredSkills": string[],
  "tools": string[],
  "responsibilities": string[],
  "seniorityLevel": string | null,
  "yearsExperience": string | null,
  "domainKeywords": string[],
  "softSkills": string[],
  "atsKeywords": string[],
  "visaSignals": string[],
  "redFlags": string[],
  "fitSummary": string
}

Rules:
- Extract skills, tools, and keywords as specific terms (e.g., "React", not "frontend framework").
- seniorityLevel: infer from title and requirements (e.g., "entry", "mid", "senior", "lead").
- redFlags: anything that might be a concern (unrealistic requirements, low pay signals, etc.).
- fitSummary: a brief assessment of what this role demands.
- Return ONLY the JSON object.`;

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const body = await req.json();
  const candidateId = body.candidateId as string | undefined;
  const jobId = body.jobId as string | undefined;
  const rawDescription = (body.rawDescription as string | undefined)?.trim();
  const sourceUrl = body.sourceUrl as string | undefined;

  if (!candidateId || !rawDescription) {
    return NextResponse.json({ error: "candidateId and rawDescription are required" }, { status: 400 });
  }

  const active = await getActiveProviderAsync();
  let parsedDescription: any = null;
  let fitScore: number | null = null;
  let recommendation: string | null = null;

  if (active) {
    try {
      const aiResponse = await active.provider.send({
        system: "You are a job description analyzer. Extract structured data and return ONLY raw JSON.",
        messages: [{ role: "user", content: [{ type: "text", text: `${JD_ANALYSIS_PROMPT}\n\n--- JOB DESCRIPTION ---\n${rawDescription}\n--- END ---` }] }],
        tools: [],
      });
      const text = textOf(aiResponse.content) ?? "";
      const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
      parsedDescription = JSON.parse(clean);

      const redFlagCount = (parsedDescription.redFlags ?? []).length;
      const skillCount = (parsedDescription.requiredSkills ?? []).length + (parsedDescription.preferredSkills ?? []).length;
      fitScore = Math.max(0, Math.min(100, skillCount * 5 - redFlagCount * 15 + 50));
      recommendation = fitScore > 70 ? "Apply" : fitScore > 40 ? "Maybe" : "Do Not Apply";
    } catch {
      // AI analysis failure is non-blocking
    }
  }

  const targetJob = await createTargetJob({
    candidate_id: candidateId,
    job_id: jobId ?? null,
    raw_description: rawDescription,
    parsed_description: parsedDescription,
    fit_score: fitScore,
    recommendation,
    created_by: context!.profile.user_id,
  });

  const keywordsToInsert: any[] = [];
  const categories: [string, string][] = [
    ["requiredSkills", "skill"],
    ["preferredSkills", "skill"],
    ["tools", "tool"],
    ["domainKeywords", "domain"],
    ["softSkills", "soft_skill"],
  ];

  for (const [field, category] of categories) {
    const items = parsedDescription?.[field] ?? [];
    for (const kw of items) {
      keywordsToInsert.push({
        target_job_id: targetJob.id,
        keyword: String(kw),
        category,
        importance: field === "requiredSkills" ? "high" : field === "preferredSkills" ? "medium" : "low",
      });
    }
  }

  if (keywordsToInsert.length > 0) {
    if (isNeon()) {
      const cols = Object.keys(keywordsToInsert[0]);
      const values: (string | number | null)[] = [];
      const placeholders: string[] = [];
      let paramIdx = 1;
      for (const r of keywordsToInsert) {
        const rowPlaceholders: string[] = [];
        for (const col of cols) {
          rowPlaceholders.push(`$${paramIdx++}`);
          values.push((r as any)[col]);
        }
        placeholders.push(`(${rowPlaceholders.join(", ")})`);
      }
      const sql = `INSERT INTO job_keywords (${cols.join(", ")}) VALUES ${placeholders.join(", ")}`;
      await query(sql, values);
    } else {
      await supabase.from("job_keywords").insert(keywordsToInsert);
    }
  }

  await logActivity({
    userId: context!.profile.user_id,
    actorName: context!.profile.display_name || context!.profile.email || undefined,
    type: "create",
    description: `Created target job analysis for candidate ${candidateId}`,
    entityType: "target_job",
    entityId: targetJob.id,
    entityName: parsedDescription?.title || "Untitled Job",
    metadata: { candidate_id: candidateId, keyword_count: keywordsToInsert.length },
  });

  return NextResponse.json({ ...targetJob, keywords: keywordsToInsert }, { status: 201 });
}
