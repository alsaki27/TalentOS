// src/lib/resumeStorage.ts
// Pluggable resume storage backend: SharePoint (default) or R2 bucket
// (RESUME_STORAGE_PROVIDER=sharepoint, see src/lib/integrations/sharepoint.ts).

import { uploadToSharePoint } from "@/lib/integrations/sharepoint";
import { uploadFile } from "@/server/storage/storageApi";

export type ResumeStorageProvider = "r2" | "sharepoint";

export function activeResumeStorageProvider(): ResumeStorageProvider {
  const p = (process.env.RESUME_STORAGE_PROVIDER || "").toLowerCase();
  return p === "r2" ? "r2" : "sharepoint";
}

export async function uploadResumeFile(path: string, buffer: Uint8Array, contentType: string): Promise<{ url: string }> {
  if (activeResumeStorageProvider() === "sharepoint") {
    return uploadToSharePoint(path, buffer, contentType);
  }

  const { url } = await uploadFile(path, buffer, contentType);
  return { url };
}
