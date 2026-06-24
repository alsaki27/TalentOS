// src/app/api/chat/attachments/route.ts
// POST -> upload a file to attach to a chat message. Stored in the existing "resumes"
// Storage bucket under chat-attachments/, same bucket every other upload in this app
// already uses (resumes, avatars, backups) — no new bucket to provision.

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { uploadFile, getPublicUrl } from "@/server/storage/storageApi";

const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_EXTRACTED_TEXT_CHARS = 20000;
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

  const { url } = await uploadFile(path, buffer, file.type || "application/octet-stream");

  let textContent: string | null = null;
  if (isTextFile(file.name)) {
    textContent = new TextDecoder().decode(buffer).slice(0, MAX_EXTRACTED_TEXT_CHARS);
  }

  return NextResponse.json({
    url,
    name: file.name,
    type: file.type || "application/octet-stream",
    textContent,
  });
}