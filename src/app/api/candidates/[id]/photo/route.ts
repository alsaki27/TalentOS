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

  let publicUrl: string;
  try {
    const result = await uploadFile(path, buffer, file.type || "application/octet-stream");
    publicUrl = result.url;
  } catch (err: any) {
    console.error("Photo upload failed:", err);
    return NextResponse.json({ error: err.message ?? "Upload failed" }, { status: 500 });
  }

  let data;
  try {
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
      if (error) throw new Error(error.message);
      data = d;
    }
  } catch (err: any) {
    // Same rollback rationale as src/app/api/candidates/[id]/resume/route.ts -
    // don't leave an uploaded file the DB has no record of.
    await deleteStorageFile(publicUrl).catch(() => {});
    console.error("Photo upload DB update failed, rolled back uploaded file:", err);
    return NextResponse.json({ error: err.message ?? "Failed to save photo reference" }, { status: 500 });
  }

  await deleteStorageFile(existing?.avatar_url).catch(() => {});

  return NextResponse.json(data);
}