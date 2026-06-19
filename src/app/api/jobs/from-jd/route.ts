// src/app/api/jobs/from-jd/route.ts
// POST -> parse a raw job description, detect duplicates, and optionally create a draft job.
// Uses the jobsRepository abstraction instead of direct Supabase queries.

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { analyzeJD, JdAnalysisInput } from "@/lib/ai/falood/jdAnalyzer";
import {
  findJobById,
  createJobFromParsedJD,
  findPotentialDuplicateJobs,
} from "@/server/repositories/jobsRepository";
import { syncCompanyDirectoryFromJobs } from "@/lib/companyDirectory";
import { logActivity } from "@/lib/activity";
import { triggerWebhooks } from "@/lib/webhookEngine";

function buildSalaryRange(
  min: number | null,
  max: number | null,
  currency: string | null,
  period: string | null
): string | null {
  if (min === null && max === null) return null;
  const parts: string[] = [];
  const sym = currency && currency.trim() ? currency.trim() : "$";
  const p = period && period !== "unknown" ? `/${period}` : "";
  if (min !== null && max !== null && min === max) {
    parts.push(formatSalaryValue(min, sym, p));
  } else {
    if (min !== null) parts.push(formatSalaryValue(min, sym, p));
    if (max !== null) parts.push(formatSalaryValue(max, sym, p));
  }
  return parts.length > 0 ? parts.join(" – ") : null;
}

function formatSalaryValue(n: number, currency: string, period: string): string {
  if (n >= 1000) {
    const k = Math.round(n / 1000);
    return `${currency}${k}k${period}`;
  }
  return `${currency}${n}${period}`;
}

function safeInsertValue<T>(value: T | null | undefined): T | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return value;
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawText = typeof body.rawText === "string" ? body.rawText.trim() : "";
  const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl.trim() || undefined : undefined;
  const forceCreate = body.forceCreate === true;
  const useExistingJobId = typeof body.useExistingJobId === "string" ? body.useExistingJobId : undefined;

  // --- A. useExistingJobId shortcut ---
  if (useExistingJobId) {
    const existingJob = await findJobById(useExistingJobId);
    if (!existingJob) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    return NextResponse.json({
      job: existingJob,
      analysis: null,
      duplicateCheck: { duplicates: [], usedExistingJobId: useExistingJobId },
    });
  }

  // --- B. Input validation ---
  if (!rawText) {
    return NextResponse.json({ error: "rawText is required" }, { status: 400 });
  }
  if (rawText.length < 100) {
    return NextResponse.json(
      { error: "rawText is too short (minimum 100 characters)" },
      { status: 400 }
    );
  }
  if (rawText.length > 30000) {
    return NextResponse.json(
      { error: "rawText is too long (maximum 30,000 characters)" },
      { status: 400 }
    );
  }

  // --- C. AI analysis ---
  let analysis: any;
  try {
    analysis = await analyzeJD({ rawText } as JdAnalysisInput);
  } catch (err: any) {
    const message = err.message ?? "Unknown error";
    if (message.includes("No AI provider configured")) {
      return NextResponse.json(
        { error: "AI analysis is unavailable. No AI provider is configured." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: `AI analysis failed: ${message}` }, { status: 502 });
  }

  // --- D. Validate title ---
  if (!analysis.title) {
    return NextResponse.json(
      { error: "AI could not identify a job title. Please edit/paste a clearer JD." },
      { status: 422 }
    );
  }

  // --- E. Duplicate detection ---
  const duplicates = await findPotentialDuplicateJobs({
    title: analysis.title,
    company: analysis.company,
    location: analysis.location,
    sourceUrl,
  });

  if (duplicates.length > 0 && !forceCreate) {
    return NextResponse.json(
      {
        error: "Possible duplicate job found",
        analysis,
        duplicates,
      },
      { status: 409 }
    );
  }

  // --- F. Map employmentType to existing DB conventions ---
  const employmentTypeMap: Record<string, string> = {
    full_time: "full-time",
    part_time: "part-time",
    contract: "contract",
    internship: "internship",
    temporary: "temporary",
    unknown: "",
  };

  const salaryRange = buildSalaryRange(
    analysis.salaryMin,
    analysis.salaryMax,
    analysis.salaryCurrency,
    analysis.salaryPeriod
  );

  // --- G. Insert job via repository ---
  try {
    const job = await createJobFromParsedJD({
      title: safeInsertValue(analysis.title),
      company: safeInsertValue(analysis.company),
      location: safeInsertValue(analysis.location),
      source: "pasted_jd",
      source_url: safeInsertValue(sourceUrl) ?? null,
      raw_description: rawText,
      parsed_description: analysis,
      ai_extracted_at: new Date().toISOString(),
      ai_confidence_score: analysis.confidenceScore,
      employment_type: safeInsertValue(employmentTypeMap[analysis.employmentType] ?? analysis.employmentType) || null,
      seniority_level: safeInsertValue(analysis.seniorityLevel),
      salary_min: safeInsertValue(analysis.salaryMin),
      salary_max: safeInsertValue(analysis.salaryMax),
      salary_currency: safeInsertValue(analysis.salaryCurrency),
      salary_period: safeInsertValue(analysis.salaryPeriod === "unknown" ? null : analysis.salaryPeriod),
      salary_range: safeInsertValue(salaryRange),
      notes: safeInsertValue(
        `AI-extracted from pasted JD. Confidence: ${Math.round(analysis.confidenceScore * 100)}%. Workplace: ${analysis.workplaceType}. Employment: ${analysis.employmentType}.`
      ),
      is_active: true,
    });

    await syncCompanyDirectoryFromJobs([job]);

    if (context) {
      await logActivity({
        userId: context.profile.user_id,
        actorName: context.profile.display_name || context.profile.email || undefined,
        type: "create",
        description: `Created job from pasted JD: ${job.title}`,
        entityType: "job",
        entityId: job.id,
        entityName: job.title,
        metadata: { company: job.company, source: "pasted_jd", ai_confidence: analysis.confidenceScore },
      });
      void triggerWebhooks("job.created", {
        job_id: job.id,
        title: job.title,
        company: job.company,
        source: "pasted_jd",
        created_by: context.profile.user_id,
      });
    }

    return NextResponse.json({
      job,
      analysis,
      duplicateCheck: { duplicates: duplicates.map((d) => d.id), forceCreated: true },
    }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
