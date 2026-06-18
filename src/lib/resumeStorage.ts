// src/lib/resumeStorage.ts
// Pluggable resume storage backend: Supabase Storage (default, unchanged behavior) or
// SharePoint (RESUME_STORAGE_PROVIDER=sharepoint, see src/lib/integrations/sharepoint.ts).
// Same provider-selection pattern as src/lib/ai/index.ts's getActiveProvider() — pick
// one explicit backend, fail clearly if the selected one isn't configured, never guess.

import { supabase } from "@/lib/supabase";
import { uploadToSharePoint } from "@/lib/integrations/sharepoint";

export type ResumeStorageProvider = "supabase" | "sharepoint";

export function activeResumeStorageProvider(): ResumeStorageProvider {
  return (process.env.RESUME_STORAGE_PROVIDER || "").toLowerCase() === "sharepoint" ? "sharepoint" : "supabase";
}

export async function uploadResumeFile(path: string, buffer: Buffer, contentType: string): Promise<{ url: string }> {
  if (activeResumeStorageProvider() === "sharepoint") {
    return uploadToSharePoint(path, buffer, contentType);
  }

  const { error } = await supabase.storage.from("resumes").upload(path, buffer, { contentType, upsert: true });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from("resumes").getPublicUrl(path);
  return { url: data.publicUrl };
}
