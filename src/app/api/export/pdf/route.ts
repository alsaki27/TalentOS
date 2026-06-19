// src/app/api/export/pdf/route.ts
// POST -> generate PDF from application resume version content
// Placeholder: returns the structured content for client-side rendering
// In production, this would use @react-pdf/renderer or puppeteer to generate an actual PDF

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const body = await req.json();
  const applicationResumeId = body.applicationResumeId as string | undefined;
  const formatting = body.formatting as Record<string, unknown> | undefined;

  if (!applicationResumeId) {
    return NextResponse.json({ error: "applicationResumeId is required" }, { status: 400 });
  }

  const { data: appResume, error: arError } = await supabase
    .from("application_resume_versions")
    .select("content, candidate_id, target_job_id")
    .eq("id", applicationResumeId)
    .single();

  if (arError || !appResume) {
    return NextResponse.json({ error: "Application resume version not found" }, { status: 404 });
  }

  const content = appResume.content as Record<string, unknown>;
  const mergedFormatting = { ...(content.formatting as Record<string, unknown> ?? {}), ...(formatting ?? {}) };

  // Placeholder: return structured data for client-side PDF generation
  // In production, use @react-pdf/renderer or puppeteer to generate actual PDF bytes
  return NextResponse.json({
    status: "placeholder",
    message: "PDF generation is a placeholder. In production, this endpoint would return a generated PDF file.",
    content: {
      ...content,
      formatting: mergedFormatting,
    },
    candidateId: appResume.candidate_id,
    targetJobId: appResume.target_job_id,
  });
}
