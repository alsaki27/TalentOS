// src/app/api/jobs/analyze/route.ts
// POST -> parse a raw job description and return structured analysis.
// Parse-only: does not create or update any database rows.

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { analyzeJD, JdAnalysisInput } from "@/lib/ai/falood/jdAnalyzer";
import { logActivity } from "@/lib/activity";

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawText = typeof body.rawText === "string" ? body.rawText.trim() : "";
  const candidateId = typeof body.candidateId === "string" ? body.candidateId : undefined;

  if (!rawText) {
    return NextResponse.json({ error: "rawText is required" }, { status: 400 });
  }

  if (rawText.length < 100) {
    return NextResponse.json(
      { error: "rawText is too short to analyze (minimum 100 characters)" },
      { status: 400 }
    );
  }

  if (rawText.length > 30000) {
    return NextResponse.json(
      { error: "rawText is too long (maximum 30,000 characters)" },
      { status: 400 }
    );
  }

  const input: JdAnalysisInput = { rawText, candidateId };

  let analysis: any;
  try {
    analysis = await analyzeJD(input);
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

  // Log activity on successful analysis
  if (context) {
    await logActivity({
      userId: context.profile.user_id,
      actorName: context.profile.display_name || context.profile.email || undefined,
      type: "create",
      description: `Analyzed job description (${analysis.title ?? "untitled"})`,
      entityType: "job_analysis",
      entityId: undefined,
      entityName: analysis.title ?? undefined,
      metadata: {
        company: analysis.company,
        confidence_score: analysis.confidenceScore,
        keyword_count: analysis.requiredSkills.length + analysis.preferredSkills.length,
      },
    });
  }

  return NextResponse.json({ analysis });
}
