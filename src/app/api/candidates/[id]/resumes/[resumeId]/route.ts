// src/app/api/candidates/[id]/resumes/[resumeId]/route.ts
// DELETE -> remove a resume/cover-letter variant

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; resumeId: string } }) {
  const { error } = await supabase
    .from("resumes")
    .delete()
    .eq("id", params.resumeId)
    .eq("candidate_id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
