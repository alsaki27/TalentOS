// src/app/api/candidates/[id]/resumes/route.ts
// GET  -> list resume/cover-letter variants for a candidate
// POST -> upload a new variant (multipart: file, label, kind)

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { data, error } = await supabase
    .from("resumes")
    .select("*")
    .eq("candidate_id", params.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const label = (formData.get("label") as string | null)?.trim();
  const kind = (formData.get("kind") as string | null) || "resume";

  if (!file) return NextResponse.json({ error: "no file provided" }, { status: 400 });
  if (!label) return NextResponse.json({ error: "label is required" }, { status: 400 });

  const ext = file.name.split(".").pop();
  const path = `candidates/${params.id}/variants/${Date.now()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadErr } = await supabase.storage
    .from("resumes")
    .upload(path, buffer, { contentType: file.type, upsert: true });

  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 });

  const { data: urlData } = supabase.storage.from("resumes").getPublicUrl(path);

  const { data, error } = await supabase
    .from("resumes")
    .insert({
      candidate_id: params.id,
      label,
      kind,
      file_url: urlData.publicUrl,
      filename: file.name,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
