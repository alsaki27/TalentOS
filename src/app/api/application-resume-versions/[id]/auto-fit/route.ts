// src/app/api/application-resume-versions/[id]/auto-fit/route.ts
// POST -> run the one-page auto-fit engine (src/lib/falood/autoFit.ts) against the
// current content. Propose-only: returns the adjusted content + what changed, but
// does NOT save it — the studio must call the existing PATCH endpoint to commit it,
// same "AI suggests, human approves" pattern as everywhere else in Falood (here it's
// a deterministic engine rather than an LLM, but the same human-approval gate applies
// since formatting changes still alter how the resume looks).

import { NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { isNeon } from "@/server/db";
import { queryOne } from "@/server/db/neon";
import { autoFitOnePage } from "@/lib/falood/autoFit";
import { ResumeDocument } from "@/lib/falood/types";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  let data: any;
  let error: any;

  if (isNeon()) {
    data = await queryOne(
      `SELECT content FROM application_resume_versions WHERE id = $1`,
      [params.id]
    );
    error = data ? null : { message: "Application resume version not found" };
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("application_resume_versions")
      .select("content")
      .eq("id", params.id)
      .single();
    data = res.data;
    error = res.error;
  }

  if (error || !data) return NextResponse.json({ error: error?.message || "Application resume version not found" }, { status: 404 });

  try {
    const result = await autoFitOnePage(data.content as ResumeDocument);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Auto-fit failed" }, { status: 500 });
  }
}
