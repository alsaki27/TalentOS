// src/server/storage/storageApi.ts
// Cloudflare R2 S3-compatible storage API for Cloudflare Workers.
// Replaces Supabase Storage with R2 object storage using AWS Signature V4 auth.
//
// Required environment variables:
//   R2_ACCOUNT_ID        - Cloudflare account ID
//   R2_ACCESS_KEY_ID     - R2 API token Access Key ID
//   R2_SECRET_ACCESS_KEY - R2 API token Secret Access Key
//   R2_BUCKET_NAME       - R2 bucket name (default: "talentos")
//   R2_PUBLIC_URL        - Public URL prefix (e.g. https://pub-xxx.r2.dev or custom domain)
//
// To set up:
// 1. Create R2 bucket in Cloudflare dashboard
// 2. Create R2 API token with "Object Read & Write" permissions
// 3. Set the 5 secrets above via wrangler secret put
// 4. (Optional) Configure a custom public domain for the bucket

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID ?? "";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID ?? "";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY ?? "";
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME ?? "talentos";
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL ?? "").replace(/\/$/, "");

function isConfigured(): boolean {
  return !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET_NAME);
}

function getR2Host(): string {
  return `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
}

function getR2Url(bucket: string, path: string, queryString = ""): string {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const base = `https://${getR2Host()}/${bucket}/${encodedPath}`;
  return queryString ? `${base}?${queryString}` : base;
}

// ── AWS Signature V4 helpers ──

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256(key: ArrayBuffer | Uint8Array | string, message: string): Promise<ArrayBuffer> {
  let keyData: any;
  if (typeof key === "string") {
    keyData = new TextEncoder().encode(key);
  } else if (key instanceof ArrayBuffer) {
    keyData = new Uint8Array(key);
  } else {
    keyData = key;
  }
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
}

async function sha256(message: string | ArrayBuffer): Promise<string> {
  const data = typeof message === "string" ? new TextEncoder().encode(message) : message;
  const hash = await crypto.subtle.digest("SHA-256", data);
  return toHex(hash);
}

async function getSignatureKey(secretKey: string, dateStamp: string, regionName: string, serviceName: string): Promise<ArrayBuffer> {
  const kDate = await hmacSha256("AWS4" + secretKey, dateStamp);
  const kRegion = await hmacSha256(kDate, regionName);
  const kService = await hmacSha256(kRegion, serviceName);
  const kSigning = await hmacSha256(kService, "aws4_request");
  return kSigning;
}

async function signRequest(
  method: string,
  bucket: string,
  objectPath: string,
  queryString: string,
  extraHeaders: Record<string, string> = {},
  body?: ArrayBuffer | string
): Promise<Record<string, string>> {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const dateStamp = timestamp.slice(0, 8);
  const region = "auto";
  const service = "s3";
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const host = getR2Host();

  const payloadHash = body ? await sha256(body) : await sha256("");

  const baseHeaders: Record<string, string> = {
    host: host,
    "x-amz-date": timestamp,
    "x-amz-content-sha256": payloadHash,
    ...extraHeaders,
  };

  const signedHeadersList = Object.keys(baseHeaders)
    .map((k) => k.toLowerCase())
    .sort()
    .join(";");

  const canonicalUri = `/${bucket}/${objectPath}`;
  const canonicalHeaders = Object.entries(baseHeaders)
    .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map(([key, value]) => `${key.toLowerCase()}:${value.trim()}\n`)
    .join("");

  const canonicalRequest = [
    method,
    canonicalUri,
    queryString,
    canonicalHeaders,
    signedHeadersList,
    payloadHash,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    timestamp,
    scope,
    await sha256(canonicalRequest),
  ].join("\n");

  const signingKey = await getSignatureKey(R2_SECRET_ACCESS_KEY, dateStamp, region, service);
  const signature = toHex(await hmacSha256(signingKey, stringToSign));

  const authHeader = `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY_ID}/${scope}, SignedHeaders=${signedHeadersList}, Signature=${signature}`;

  return {
    ...baseHeaders,
    Authorization: authHeader,
  };
}

// ── Public API ──

export function getPublicUrl(path: string): string {
  if (!R2_PUBLIC_URL) {
    // Fallback to R2 S3 endpoint (not publicly readable by default)
    return `https://${getR2Host()}/${R2_BUCKET_NAME}/${path}`;
  }
  return `${R2_PUBLIC_URL}/${path}`;
}

export interface StorageUploadResult {
  url: string;
}

export async function uploadFile(
  path: string,
  buffer: Uint8Array,
  contentType: string
): Promise<StorageUploadResult> {
  if (!isConfigured()) {
    throw new Error(
      "R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME."
    );
  }

  const headers = await signRequest(
    "PUT",
    R2_BUCKET_NAME,
    path,
    "",
    { "Content-Type": contentType },
    buffer.buffer as ArrayBuffer
  );

  const res = await fetch(getR2Url(R2_BUCKET_NAME, path), {
    method: "PUT",
    headers,
    body: buffer.buffer as ArrayBuffer,
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "R2 upload failed");
    throw new Error(`R2 upload failed (${res.status}): ${err}`);
  }

  return { url: getPublicUrl(path) };
}

export async function downloadFile(path: string): Promise<Blob> {
  if (!isConfigured()) {
    throw new Error(
      "R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME."
    );
  }

  const headers = await signRequest("GET", R2_BUCKET_NAME, path, "");

  const res = await fetch(getR2Url(R2_BUCKET_NAME, path), {
    method: "GET",
    headers,
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "R2 download failed");
    throw new Error(`R2 download failed (${res.status}): ${err}`);
  }

  return res.blob();
}

export async function deleteFile(path: string): Promise<void> {
  if (!isConfigured()) {
    console.error("R2 is not configured. Skipping file deletion.");
    return;
  }
  if (!path) return;

  const headers = await signRequest("DELETE", R2_BUCKET_NAME, path, "");

  const res = await fetch(getR2Url(R2_BUCKET_NAME, path), {
    method: "DELETE",
    headers,
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "R2 delete failed");
    console.error(`R2 delete failed (${res.status}): ${err}`);
  }
}

export interface StorageListItem {
  name: string;
  created_at: string;
  metadata?: { size?: number };
}

function parseListObjectsXml(xml: string): StorageListItem[] {
  const items: StorageListItem[] = [];
  const contentsRegex = /<Contents>([\s\S]*?)<\/Contents>/g;
  let match: RegExpExecArray | null;
  while ((match = contentsRegex.exec(xml)) !== null) {
    const content = match[1];
    const keyMatch = content.match(/<Key>([^<]+)<\/Key>/);
    const modifiedMatch = content.match(/<LastModified>([^<]+)<\/LastModified>/);
    const sizeMatch = content.match(/<Size>(\d+)<\/Size>/);
    if (keyMatch) {
      items.push({
        name: keyMatch[1],
        created_at: modifiedMatch ? modifiedMatch[1] : "",
        metadata: sizeMatch ? { size: parseInt(sizeMatch[1], 10) } : undefined,
      });
    }
  }
  return items;
}

export async function listFiles(prefix: string, limit: number = 20): Promise<StorageListItem[]> {
  if (!isConfigured()) {
    throw new Error(
      "R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME."
    );
  }

  const queryParams: Record<string, string> = {
    "list-type": "2",
    "max-keys": String(limit),
    prefix: prefix,
  };
  const queryString = Object.entries(queryParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  const headers = await signRequest("GET", R2_BUCKET_NAME, "", queryString);

  const res = await fetch(getR2Url(R2_BUCKET_NAME, "", queryString), {
    method: "GET",
    headers,
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "R2 list failed");
    throw new Error(`R2 list failed (${res.status}): ${err}`);
  }

  const xml = await res.text();
  return parseListObjectsXml(xml);
}

export async function deleteStorageFile(url: string | null | undefined): Promise<void> {
  if (!url) return;

  // Try R2 public URL format
  if (R2_PUBLIC_URL && url.startsWith(R2_PUBLIC_URL + "/")) {
    const path = decodeURIComponent(url.slice(R2_PUBLIC_URL.length + 1));
    await deleteFile(path);
    return;
  }

  // Try to extract path from any URL
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\/+/, "").replace(new RegExp(`^${R2_BUCKET_NAME}/`), "");
    if (path) {
      await deleteFile(path);
    }
  } catch {
    console.error(`Failed to parse storage URL for deletion: ${url}`);
  }
}
