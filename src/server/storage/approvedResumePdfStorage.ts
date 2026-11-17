import { getCloudflareContext } from "@opennextjs/cloudflare";
import { sha256Hex } from "@/lib/sha256";

export const TEMPORARY_RESUME_PDF_PROVIDER = "approved_pdf_staging";

type TemporaryPdfBucket = {
  put(key: string, bytes: Uint8Array, options: {
    sha256: string;
    onlyIf: Headers;
    httpMetadata: { contentType: string };
  }): Promise<{ size: number } | null>;
  get(key: string): Promise<{ size: number; arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string; limit: number; cursor?: string }): Promise<{
    objects: Array<{ key: string; uploaded: Date }>; truncated: boolean; cursor?: string;
  }>;
};

function stagingBucket() {
  try {
    const { env } = getCloudflareContext();
    return (env as { RESUME_PDF_STAGING?: TemporaryPdfBucket }).RESUME_PDF_STAGING;
  } catch {
    return undefined;
  }
}

export function stagedResumePdfWritesEnabled() {
  return process.env.RESUME_PDF_STAGING_ENABLED !== "false" && Boolean(stagingBucket());
}

export class StagedResumePdfMissingError extends Error {}

export async function readTemporaryResumePdf(key: string, expectedHash?: string) {
  const bucket = stagingBucket();
  if (!bucket) throw new Error("Temporary résumé storage is unavailable.");
  const object = await bucket.get(key);
  if (!object) throw new StagedResumePdfMissingError("The temporary résumé PDF was not found.");
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (expectedHash && await sha256Hex(bytes) !== expectedHash) throw new Error("The temporary PDF checksum does not match approval.");
  return bytes;
}

export async function saveTemporaryResumePdf(key: string, bytes: Uint8Array, sha256: string) {
  const bucket = stagingBucket();
  if (!bucket) throw new Error("Temporary résumé storage is unavailable.");
  const record = await bucket.put(key, bytes, {
    sha256, onlyIf: new Headers({ "If-None-Match": "*" }), httpMetadata: { contentType: "application/pdf" },
  });
  if (!record) {
    const previous = await readTemporaryResumePdf(key, sha256);
    if (previous.byteLength !== bytes.byteLength) throw new Error("The temporary PDF has a different size.");
  } else if (record.size !== bytes.byteLength) {
    throw new Error("The temporary PDF write did not store every byte.");
  }
}

export async function removeTemporaryResumePdf(key: string) {
  const bucket = stagingBucket();
  if (!bucket) throw new Error("Temporary résumé storage is unavailable.");
  await bucket.delete(key);
}

export async function listTemporaryResumePdfs(cursor?: string) {
  return stagingBucket()?.list({ prefix: "approved-resumes/", limit: 250, cursor });
}
