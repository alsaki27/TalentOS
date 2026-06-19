// src/app/api/candidates/[id]/evidence/from-resume/route.ts
// POST -> convert a parsed resume's structured fields into evidence bank rows.

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext, MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { supabase } from "@/lib/supabase";
import { parsedResumeToEvidence } from "@/lib/resumeParsing";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();
  const resumeId = body.resume_id as string | undefined;

  if (!resumeId) {
    return NextResponse.json({ error: "resume_id is required" }, { status: 400 });
  }

  // Fetch the parsed resume
  const { data: resume, error: resErr } = await supabase
    .from("resumes")
    .select("parsed_json")
    .eq("id", resumeId)
    .eq("candidate_id", params.id)
    .single();

  if (resErr || !resume) {
    return NextResponse.json({ error: "Resume not found or does not belong to this candidate" }, { status: 404 });
  }

  if (!resume.parsed_json) {
    return NextResponse.json({ error: "Resume has no parsed data" }, { status: 400 });
  }

  const evidenceRows = parsedResumeToEvidence(resume.parsed_json as any);
  if (evidenceRows.length === 0) {
    return NextResponse.json({ created: 0, rows: [] });
  }

  const insertData = evidenceRows.map((row) => ({
    candidate_id: params.id,
    source_type: row.source_type,
    title: row.title,
    description: row.description,
    related_skills: row.related_skills,
    confidence_score: row.confidence_score,
    created_by: context!.profile.user_id,
  }));

  const { data, error } = await supabase
    .from("candidate_evidence")
    .insert(insertData)
    .select();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logActivity({
    userId: context!.profile.user_id,
    actorName: context!.profile.display_name || context!.profile.email || undefined,
    type: "create",
    description: `Auto-generated ${evidenceRows.length} evidence entries from parsed resume for candidate ${params.id}`,
    entityType: "candidate_evidence",
    entityId: resumeId,
    entityName: "Parsed resume evidence",
    metadata: { candidate_id: params.id, resume_id: resumeId, count: evidenceRows.length },
  });

  return NextResponse.json({ created: evidenceRows.length, rows: data ?? [] });
}
