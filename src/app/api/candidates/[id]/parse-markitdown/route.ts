import { NextRequest, NextResponse } from "next/server";
import { isNeon } from "@/server/db";
import { query, queryOne } from "@/server/db/neon";
import { convertPdfToMarkdown } from "@/lib/markitdown";
import { parseResumeFields } from "@/lib/resumeParsing";
import { downloadFromSharePoint } from "@/lib/integrations/sharepoint";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const resumeId = body.resume_id as string | undefined;

  if (!resumeId) {
    return NextResponse.json({ error: "resume_id is required" }, { status: 400 });
  }

  // 1. Get the resume file URL
  let resume: any;
  if (isNeon()) {
    resume = await queryOne<{ file_url: string; filename: string }>(
      'SELECT file_url, filename FROM resumes WHERE id = $1 AND candidate_id = $2',
      [resumeId, params.id]
    );
  } else {
    const { supabase } = await import("@/lib/supabase");
    const { data } = await supabase
      .from("resumes")
      .select("file_url, filename")
      .eq("id", resumeId)
      .eq("candidate_id", params.id)
      .single();
    resume = data;
  }

  if (!resume) {
    return NextResponse.json({ error: "Resume not found" }, { status: 404 });
  }

  // 2. Download the PDF
  let buffer: Uint8Array;
  try {
    if (resume.file_url.includes("sharepoint.com")) {
      const result = await downloadFromSharePoint(resume.file_url);
      buffer = result.buffer;
    } else {
      const res = await fetch(resume.file_url);
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      buffer = new Uint8Array(await res.arrayBuffer());
    }
  } catch (err: any) {
    return NextResponse.json({ error: `Failed to download resume: ${err.message}` }, { status: 500 });
  }

  // 3. Convert to markdown with markitdown
  const mdResult = await convertPdfToMarkdown(buffer, resume.filename);
  if (!mdResult.success) {
    return NextResponse.json({ error: mdResult.error }, { status: 500 });
  }

  // 4. Parse structured data from markdown using AI
  const parsed = await parseResumeFields(mdResult.markdown!);

  // 5. Save parsed_json to the resume record
  if (isNeon()) {
    await query(
      'UPDATE resumes SET parsed_json = $1 WHERE id = $2',
      [parsed, resumeId]
    );
  } else {
    const { supabase } = await import("@/lib/supabase");
    await supabase.from("resumes").update({ parsed_json: parsed }).eq("id", resumeId);
  }

  return NextResponse.json({ parsed, markdown: mdResult.markdown });
}
