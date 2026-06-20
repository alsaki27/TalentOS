// src/app/api/export/pdf/route.ts
// POST -> generate a real PDF from an application resume version (or a base resume)
// using the Skarion Compact Professional layout (src/lib/falood/skarionPdfDocument.tsx),
// rendered via @react-pdf/renderer. Returns actual PDF bytes, not JSON.

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { queryOne } from "@/server/db/neon";
import { renderResumePdf } from "@/lib/falood/pdfExport";
import { ResumeDocument } from "@/lib/falood/types";

export async function POST(req: NextRequest) {
  const { response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const body = await req.json();
  const applicationResumeId = body.applicationResumeId as string | undefined;
  const baseResumeId = body.baseResumeId as string | undefined;
  const formattingOverride = body.formatting as Record<string, unknown> | undefined;

  if (!applicationResumeId && !baseResumeId) {
    return NextResponse.json({ error: "applicationResumeId or baseResumeId is required" }, { status: 400 });
  }

  let data: any;
  let error: any;

  if (isNeon()) {
    if (applicationResumeId) {
      data = await queryOne(
        'SELECT content, candidate_id FROM application_resume_versions WHERE id = $1',
        [applicationResumeId]
      );
      error = data ? null : { message: 'Resume not found' };
    } else if (baseResumeId) {
      data = await queryOne(
        'SELECT content, candidate_id FROM base_resumes WHERE id = $1',
        [baseResumeId]
      );
      error = data ? null : { message: 'Resume not found' };
    } else {
      return NextResponse.json({ error: "applicationResumeId or baseResumeId is required" }, { status: 400 });
    }
  } else {
    const res = applicationResumeId
      ? await supabase.from("application_resume_versions").select("content, candidate_id").eq("id", applicationResumeId).single()
      : await supabase.from("base_resumes").select("content, candidate_id").eq("id", baseResumeId).single();
    data = res.data;
    error = res.error;
  }

  if (error || !data) {
    return NextResponse.json({ error: "Resume not found" }, { status: 404 });
  }

  const content: ResumeDocument = {
    ...(data.content as ResumeDocument),
    formatting: { ...(data.content as ResumeDocument).formatting, ...(formattingOverride ?? {}) },
  };

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = await renderResumePdf(content);
  } catch (err: any) {
    return NextResponse.json({ error: `PDF generation failed: ${err.message ?? err}` }, { status: 500 });
  }

  const fileName = `${content.header.fullName.replace(/[^a-z0-9]+/gi, "_")}_resume.pdf`;
  return new NextResponse(new Blob([new Uint8Array(pdfBuffer)]), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
