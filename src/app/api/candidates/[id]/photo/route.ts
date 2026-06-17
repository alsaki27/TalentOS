// src/app/api/candidates/[id]/photo/route.ts
// POST -> upload a profile picture, store in the existing 'resumes' Supabase Storage
// bucket under an avatars/ prefix, and update candidates.avatar_url.

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { deleteStorageFile } from "@/lib/storage";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "no file provided" }, { status: 400 });
  }

  const { data: existing } = await supabase
    .from("candidates")
    .select("avatar_url")
    .eq("id", params.id)
    .single();

  const ext = file.name.split(".").pop();
  const path = `avatars/${params.id}/${Date.now()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadErr } = await supabase.storage
    .from("resumes")
    .upload(path, buffer, { contentType: file.type, upsert: true });

  if (uploadErr) {
    return NextResponse.json({ error: uploadErr.message }, { status: 500 });
  }

  const { data: urlData } = supabase.storage.from("resumes").getPublicUrl(path);

  const { data, error } = await supabase
    .from("candidates")
    .update({ avatar_url: urlData.publicUrl })
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await deleteStorageFile(existing?.avatar_url);

  return NextResponse.json(data);
}
