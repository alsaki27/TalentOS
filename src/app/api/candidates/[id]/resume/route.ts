// src/app/api/candidates/[id]/resume/route.ts
// POST -> upload a resume file, store in configured storage (R2 or SharePoint),
// insert into resumes table, and update candidates.resume_url + resume_filename.

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
    console.error("Resume upload failed:", err);
    return NextResponse.json({ error: err.message ?? "Upload failed", details: String(err) }, { status: 500 });
  }

  let data;
  try {
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
      if (error) throw new Error(error.message);
      data = d;
    }
  } catch (err: any) {
    // The upload already succeeded — roll back the file to avoid orphans
    await deleteResumeFile(uploaded.url).catch(() => {});
    console.error("Resume upload DB update failed, rolled back uploaded file:", err);
    return NextResponse.json({ error: err.message ?? "Failed to save resume reference" }, { status: 500 });
  }

  // ── INSERT INTO resumes TABLE so the frontend can find it ──
  // The frontend's primaryResume comes from candidate.resumes, NOT candidates.resume_url.
  try {
    if (isNeon()) {
      await execute(
        `INSERT INTO resumes (candidate_id, label, kind, file_url, filename, is_original_upload)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [params.id, file.name, "resume", uploaded.url, file.name, true]
      );
    } else {
      const { error } = await supabase
        .from("resumes")
        .insert({
          candidate_id: params.id,
          label: file.name,
          kind: "resume",
          file_url: uploaded.url,
          filename: file.name,
          is_original_upload: true,
        });
      if (error) {
        console.error("Failed to insert into resumes table:", error);
        // Don't fail the whole upload — the file is stored and candidate row is updated.
        // But this is a bug we should surface.
      }
    }
  } catch (err: any) {
    console.error("Resume insert into resumes table failed:", err);
    // Non-critical: the file is still stored and candidate is updated.
    // We log the error but don't fail the request.
  }

  try {
    await deleteResumeFile(existing?.resume_url);
  } catch {
    // Old file delete failure is non-critical; upload already succeeded
  }

  return NextResponse.json(data);
}
