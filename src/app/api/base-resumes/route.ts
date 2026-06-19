// src/app/api/base-resumes/route.ts
// GET  -> list base resumes for a candidate (?candidateId=)
// POST -> create a new base resume. Starting source determines initial content:
//   "blank" -> empty skeleton from candidate contact info
//   "uploaded_resume" -> skeleton seeded with the candidate's parsed original resume
//     (skills/experience/education copied in, ready for /create-base to refine)
//   duplicate of an existing base resume -> pass sourceBaseResumeId instead

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { logActivity } from "@/lib/activity";
import { buildSkeletonDocument } from "@/lib/ai/faloodBaseResume";
import { ResumeDocument } from "@/lib/falood/types";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const candidateId = new URL(req.url).searchParams.get("candidateId");
  if (!candidateId) return NextResponse.json({ error: "candidateId is required" }, { status: 400 });

  const { data, error } = await supabase
    .from("base_resumes")
    .select("id, name, target_industry, target_roles, style_id, status, created_at, updated_at")
    .eq("candidate_id", candidateId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const body = await req.json();
  const candidateId = body.candidateId as string | undefined;
  const name = (body.name as string | undefined)?.trim();
  const targetIndustry = body.targetIndustry as string | undefined;
  const targetRoles = (body.targetRoles as string[] | undefined) ?? [];
  const styleId = (body.styleId as string | undefined) || "skarion_compact_professional";
  const startingSource = (body.startingSource as string | undefined) || "blank";
  const sourceBaseResumeId = body.sourceBaseResumeId as string | undefined;

  if (!candidateId || !name) {
    return NextResponse.json({ error: "candidateId and name are required" }, { status: 400 });
  }

  const { data: candidate, error: candidateError } = await supabase
    .from("candidates")
    .select("id, name, email, phone, linkedin_url, github_url, portfolio_url")
    .eq("id", candidateId)
    .single();
  if (candidateError || !candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

  const { data: style } = await supabase.from("resume_styles").select("formatting_defaults").eq("id", styleId).single();
  const formatting = { styleId, ...(style?.formatting_defaults ?? {}) };

  let content: ResumeDocument;

  if (startingSource === "duplicate" && sourceBaseResumeId) {
    const { data: source } = await supabase.from("base_resumes").select("content").eq("id", sourceBaseResumeId).single();
    content = source?.content ?? buildSkeletonDocument(candidate, formatting);
  } else if (startingSource === "uploaded_resume") {
    const { data: originalResume } = await supabase
      .from("resumes")
      .select("parsed_json")
      .eq("candidate_id", candidateId)
      .eq("is_original_upload", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const parsed = originalResume?.parsed_json as any;
    content = buildSkeletonDocument(candidate, formatting);
    if (parsed) {
      if (parsed.summary) content.summary = { id: "summary", text: parsed.summary };
      if (Array.isArray(parsed.skills) && parsed.skills.length) {
        content.skills = [{ id: "skills-1", title: "Skills", skills: parsed.skills }];
      }
      if (Array.isArray(parsed.experience)) {
        content.experience = parsed.experience.map((exp: any, i: number) => ({
          id: `exp-${i}`,
          title: exp.title ?? "",
          company: exp.company ?? "",
          startDate: exp.start_date ?? "",
          endDate: exp.end_date ?? undefined,
          bullets: exp.description ? [{ id: `exp-${i}-b0`, text: exp.description }] : [],
        }));
      }
      if (Array.isArray(parsed.education)) {
        content.education = parsed.education.map((edu: any, i: number) => ({
          id: `edu-${i}`,
          degree: edu.degree ?? "",
          school: edu.school ?? "",
          graduationDate: edu.graduation_year ?? undefined,
        }));
      }
    }
  } else {
    content = buildSkeletonDocument(candidate, formatting);
  }

  const { data, error } = await supabase
    .from("base_resumes")
    .insert({
      candidate_id: candidateId,
      name,
      target_industry: targetIndustry ?? null,
      target_roles: targetRoles,
      style_id: styleId,
      content,
      created_by: context!.profile.user_id,
      updated_by: context!.profile.user_id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logActivity({
    userId: context!.profile.user_id,
    actorName: context!.profile.display_name || context!.profile.email || "",
    type: "create",
    description: `Created base resume "${name}" for candidate`,
    entityType: "base_resume",
    entityId: data.id,
    entityName: name,
    metadata: { candidate_id: candidateId, starting_source: startingSource },
  });

  return NextResponse.json(data, { status: 201 });
}
