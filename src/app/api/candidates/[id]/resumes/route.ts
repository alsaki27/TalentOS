// src/app/api/candidates/[id]/resumes/route.ts
// GET  -> list resume/cover-letter variants for a candidate
// POST -> upload a new variant (multipart: file, label, kind)

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUserContext } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { isNeon } from "@/server/db";
import { query, queryOne, execute } from "@/server/db/neon";
import { uploadResumeFile } from "@/lib/resumeStorage";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (isNeon()) {
    const data = await query<Record<string, any>>(
      'SELECT * FROM resumes WHERE candidate_id = $1 ORDER BY created_at DESC',
      [params.id]
    );
    return NextResponse.json(data);
  } else {
    const { supabase } = await import("@/lib/supabase");
    const { data, error } = await supabase
      .from("resumes")
      .select("*")
      .eq("candidate_id", params.id)
      .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json(data);
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const currentUser = await getCurrentUserContext();

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const label = (formData.get("label") as string | null)?.trim();
  const kind = (formData.get("kind") as string | null) || "resume";
  const isOriginalUpload = (formData.get("is_original_upload") as string | null) === "true";

  if (!file) return NextResponse.json({ error: "no file provided" }, { status: 400 });
  if (!label && !isOriginalUpload) return NextResponse.json({ error: "label is required" }, { status: 400 });

  const ext = file.name.split(".").pop();
  const path = `candidates/${params.id}/variants/${Date.now()}.${ext}`;
  const buffer = new Uint8Array(await file.arrayBuffer());

  let uploaded: { url: string };
  try {
    uploaded = await uploadResumeFile(path, buffer, file.type);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Upload failed" }, { status: 500 });
  }

  let parsedJson: Record<string, unknown> | null = null;
  if (isOriginalUpload) {
    try {
      const { extractText, parseResumeFields } = await import("@/lib/resumeParsing");
      const rawText = await extractText(buffer, file.type);
      const parsed = await parseResumeFields(rawText);
      parsedJson = parsed as unknown as Record<string, unknown>;
    } catch {
      // Parsing failure is non-blocking — the file still uploads
      parsedJson = null;
    }
  }

  let data;
  if (isNeon()) {
    data = await queryOne<Record<string, any>>(
      `INSERT INTO resumes (candidate_id, label, kind, file_url, filename, is_original_upload, parsed_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        params.id,
        label || (isOriginalUpload ? "Original Upload" : "Untitled"),
        kind,
        uploaded.url,
        file.name,
        isOriginalUpload,
        parsedJson,
      ]
    );
  } else {
    const { supabase } = await import("@/lib/supabase");
    const { data: d, error } = await supabase
      .from("resumes")
      .insert({
        candidate_id: params.id,
        label: label || (isOriginalUpload ? "Original Upload" : "Untitled"),
        kind,
        file_url: uploaded.url,
        filename: file.name,
        is_original_upload: isOriginalUpload,
        parsed_json: parsedJson,
      })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    data = d;
  }

  if (currentUser && data) {
    await logActivity({
      userId: currentUser.profile.user_id,
      actorName: currentUser.profile.display_name || currentUser.profile.email || undefined,
      type: "create",
      description: `Uploaded ${kind} "${label}" for candidate ${params.id}`,
      entityType: "resume",
      entityId: data.id,
      entityName: label,
      metadata: { candidate_id: params.id, filename: file.name, is_original_upload: isOriginalUpload },
    });
  }

  return NextResponse.json(data, { status: 201 });
}
