// src/app/api/candidates/[id]/resume/route.ts
// POST -> upload a resume file for this candidate, store in Supabase Storage,
// and update candidates.resume_url + resume_filename.

import { NextRequest, NextResponse } from "next/server";
import { isNeon } from "@/server/db";
import { query, queryOne, execute } from "@/server/db/neon";
import { deleteResumeFile } from "@/lib/resumeStorage";
import { uploadResumeFile } from "@/lib/resumeStorage";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "no file provided" }, { status: 400 });
  }

  const { supabase } = await import("@/lib/supabase");

  let existing;
  if (isNeon()) {
    existing = await queryOne<{ resume_url: string | null }>(
      'SELECT resume_url FROM candidates WHERE id = $1',
      [params.id]
    );
  } else {
    const { data } = await supabase
      .from("candidates")
      .select("resume_url")
      .eq("id", params.id)
      .single();
    existing = data;
  }

  const ext = file.name.split(".").pop();
  const path = `candidates/${params.id}/${Date.now()}.${ext}`;
  const buffer = new Uint8Array(await file.arrayBuffer());

  let uploaded: { url: string };
  try {
    uploaded = await uploadResumeFile(path, buffer, file.type);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Upload failed" }, { status: 500 });
  }

  let data;
  if (isNeon()) {
    data = await queryOne<Record<string, any>>(
      'UPDATE candidates SET resume_url = $1, resume_filename = $2, updated_at = NOW() WHERE id = $3 RETURNING *',
      [uploaded.url, file.name, params.id]
    );
  } else {
    const { data: d, error } = await supabase
      .from("candidates")
      .update({ resume_url: uploaded.url, resume_filename: file.name })
      .eq("id", params.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    data = d;
  }

  await deleteResumeFile(existing?.resume_url);

  return NextResponse.json(data);
}
