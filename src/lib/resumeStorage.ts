// src/lib/resumeStorage.ts
// Pluggable resume storage backend: R2 (default) or SharePoint.
// Set RESUME_STORAGE_PROVIDER=sharepoint to use SharePoint (requires MS_* env vars).
// If the selected provider is not configured, a clear error is thrown on upload.

import { uploadToSharePoint, deleteFromSharePoint } from "@/lib/integrations/sharepoint";
import { uploadFile, deleteStorageFile } from "@/server/storage/storageApi";

export type ResumeStorageProvider = "r2" | "sharepoint";

export function activeResumeStorageProvider(): ResumeStorageProvider {
  const p = (process.env.RESUME_STORAGE_PROVIDER || "").toLowerCase();
  return p === "sharepoint" ? "sharepoint" : "r2";
}

export function isProviderConfigured(provider: ResumeStorageProvider): boolean {
  if (provider === "r2") {
    return !!(
      process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET_NAME
    );
  }
  if (provider === "sharepoint") {
    return !!(
      process.env.MS_TENANT_ID &&
      process.env.MS_CLIENT_ID &&
      process.env.MS_CLIENT_SECRET &&
      process.env.SHAREPOINT_SITE_ID
    );
  }
  return false;
}

function assertProviderConfigured(provider: ResumeStorageProvider): void {
  if (!isProviderConfigured(provider)) {
    const missing =
      provider === "r2"
        ? "R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME"
        : "MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, SHAREPOINT_SITE_ID";
    throw new Error(
      `Resume storage provider '${provider}' is selected but not configured. Missing env vars: ${missing}. ` +
      `Set RESUME_STORAGE_PROVIDER=r2 or configure the required ${provider === "r2" ? "R2" : "SharePoint"} credentials.`
    );
  }
}

export async function uploadResumeFile(
  path: string,
  buffer: Uint8Array,
  contentType: string
): Promise<{ url: string }> {
  const provider = activeResumeStorageProvider();
  assertProviderConfigured(provider);

  if (provider === "sharepoint") {
    return uploadToSharePoint(path, buffer, contentType);
  }

  const { url } = await uploadFile(path, buffer, contentType);
  return { url };
}

export async function deleteResumeFile(url: string | null | undefined): Promise<void> {
  if (!url) return;

  // If the URL is clearly a SharePoint URL, try SharePoint deletion first
  if (url.includes("sharepoint.com") || url.includes("onedrive")) {
    try {
      await deleteFromSharePoint(url);
      return;
    } catch (err) {
      console.warn("SharePoint delete failed, falling back to R2 delete:", err);
    }
  }

  // R2 deletion (also handles URLs that look like R2 public URLs or generic paths)
  try {
    await deleteStorageFile(url);
  } catch (err) {
    console.warn("R2 delete failed:", err);
  }
}
