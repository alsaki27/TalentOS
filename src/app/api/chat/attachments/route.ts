// src/app/api/chat/attachments/route.ts
// POST -> upload a file to attach to a chat message. Stored in the existing "resumes"
// Storage bucket under chat-attachments/, same bucket every other upload in this app
// already uses (resumes, avatars, backups) — no new bucket to provision.
// Text-based files have their content extracted here so the assistant can read them;
// other types are stored/shown but not analyzed (see migration comment for why).

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_EXTRACTED_TEXT_CHARS = 20000; // bounds prompt size if a huge text file is attached
const TEXT_EXTENSIONS = [".txt", ".md", ".csv", ".json", ".log"];

function isTextFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "no file provided" }, { status: 400 });

  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: `File too large (max ${MAX_SIZE_BYTES / 1024 / 1024}MB).` }, { status: 400 });
  }

  const buffer = new Uint8Array(await file.arrayBuffer());
  const path = `chat-attachments/${context!.profile.user_id}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;

  const { error: uploadErr } = await supabase.storage
    .from("resumes")
    .upload(path, buffer, { contentType: file.type || "application/octet-stream", upsert: true });

  if (uploadErr) return NextResponse.json({ error: uploadErr.message }, { status: 500 });

  const { data: urlData } = supabase.storage.from("resumes").getPublicUrl(path);

  let textContent: string | null = null;
  if (isTextFile(file.name)) {
    textContent = new TextDecoder().decode(buffer).slice(0, MAX_EXTRACTED_TEXT_CHARS);
  }

  return NextResponse.json({
    url: urlData.publicUrl,
    name: file.name,
    type: file.type || "application/octet-stream",
    textContent,
  });
}
