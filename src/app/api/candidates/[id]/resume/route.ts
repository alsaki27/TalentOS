// src/app/api/candidates/[id]/resume/route.ts
// POST -> upload a resume file for this candidate, store in Supabase Storage,
// and update candidates.resume_url + resume_filename.

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { deleteStorageFile } from "@/lib/storage";
import { uploadResumeFile } from "@/lib/resumeStorage";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "no file provided" }, { status: 400 });
  }

  const { data: existing } = await supabase
    .from("candidates")
    .select("resume_url")
    .eq("id", params.id)
    .single();

  const ext = file.name.split(".").pop();
  const path = `candidates/${params.id}/${Date.now()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  let uploaded: { url: string };
  try {
    uploaded = await uploadResumeFile(path, buffer, file.type);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Upload failed" }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("candidates")
    .update({ resume_url: uploaded.url, resume_filename: file.name })
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await deleteStorageFile(existing?.resume_url);

  return NextResponse.json(data);
}
