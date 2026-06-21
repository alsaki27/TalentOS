// src/app/api/candidates/[id]/photo/route.ts
// POST -> upload a profile picture, store in the existing 'resumes' Supabase Storage
// bucket under an avatars/ prefix, and update candidates.avatar_url.

import { NextRequest, NextResponse } from "next/server";
import { isNeon } from "@/server/db";
import { query, queryOne } from "@/server/db/neon";
import { deleteStorageFile } from "@/server/storage/storageApi";
import { uploadFile, getPublicUrl } from "@/server/storage/storageApi";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "no file provided" }, { status: 400 });
  }

  let existing;
  if (isNeon()) {
    existing = await queryOne<{ avatar_url: string | null }>(
      'SELECT avatar_url FROM candidates WHERE id = $1',
      [params.id]
    );
  } else {
    const { supabase } = await import("@/lib/supabase");
    const { data } = await supabase
      .from("candidates")
      .select("avatar_url")
      .eq("id", params.id)
      .single();
    existing = data;
  }

  const ext = file.name.split(".").pop();
  const path = `avatars/${params.id}/${Date.now()}.${ext}`;
  const buffer = new Uint8Array(await file.arrayBuffer());

  const { url: publicUrl } = await uploadFile(path, buffer, file.type || "application/octet-stream");

  let data;
  if (isNeon()) {
    data = await queryOne<Record<string, any>>(
      'UPDATE candidates SET avatar_url = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [publicUrl, params.id]
    );
  } else {
    const { supabase } = await import("@/lib/supabase");
    const { data: d, error } = await supabase
      .from("candidates")
      .update({ avatar_url: publicUrl })
      .eq("id", params.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    data = d;
  }

  await deleteStorageFile(existing?.avatar_url);

  return NextResponse.json(data);
}