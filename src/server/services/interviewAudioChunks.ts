import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { INTERVIEW_AUDIO_CHUNK_BYTES } from "@/lib/applicationInterviewPreparation";
import { createSharePointUploadSession, findSharePointUpload } from "@/lib/integrations/sharepoint";
import type { PreparationUpload } from "./interviewPreparationFiles";

interface Session {
  file: PreparationUpload;
  uploadUrl: string;
  expires: number;
}

// Keep the preauthenticated Graph URL on the server. Bind each encrypted
// handle to the signed-in uploader and the exact application and stage.
function sessionKey() {
  const secret = process.env.MS_CLIENT_SECRET;
  if (!secret) throw new Error("SharePoint credentials unavailable.");
  return createHash("sha256").update("TalentOS interview audio v1\0").update(secret).digest();
}

function openSession(handle: string, scope: string): Session {
  const packed = Buffer.from(handle, "base64url");
  const cipher = createDecipheriv("aes-256-gcm", sessionKey(), packed.subarray(0, 12));
  cipher.setAAD(Buffer.from(scope));
  cipher.setAuthTag(packed.subarray(12, 28));
  return JSON.parse(Buffer.concat([cipher.update(packed.subarray(28)), cipher.final()]).toString());
}

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function startAudioUpload(file: PreparationUpload, scope: string) {
  try {
    const uploadUrl = await createSharePointUploadSession(file.path);
    const session: Session = { file, uploadUrl, expires: Date.now() + 24 * 60 * 60 * 1000 };
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", sessionKey(), iv);
    cipher.setAAD(Buffer.from(scope));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(session)), cipher.final()]);
    const handle = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
    return NextResponse.json({ handle }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return error("SharePoint could not start the recording upload.", 502);
  }
}

async function readFragment(request: Request, length: number) {
  const declared = request.headers.get("content-length");
  if (!request.body || (declared !== null && Number(declared) !== length)) return null;
  const bytes = new Uint8Array(length);
  const reader = request.body.getReader();
  let offset = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) return offset === length ? bytes : null;
    if (value.length > length - offset) {
      await reader.cancel();
      return null;
    }
    bytes.set(value, offset);
    offset += value.length;
  }
}

export async function receiveAudioChunk(request: Request, scope: string, matchesType: (ext: string, data: Uint8Array) => boolean) {
  let session: Session;
  try {
    session = openSession(request.headers.get("x-recording-upload") || "", scope);
  } catch {
    return error("Invalid recording upload session.", 403);
  }
  if (session.expires <= Date.now()) return error("The upload expired. Select the recording again.", 410);
  const { file, uploadUrl } = session;
  const range = request.headers.get("content-range") || "";
  const parts = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
  if (!parts) return error("Invalid recording byte range.", 400);
  const [start, end, total] = parts.slice(1).map(Number);
  if (total !== file.size || start >= total || start % INTERVIEW_AUDIO_CHUNK_BYTES !== 0 ||
      end !== Math.min(start + INTERVIEW_AUDIO_CHUNK_BYTES, total) - 1) {
    return error("Invalid recording byte range.", 400);
  }
  const bytes = await readFragment(request, end - start + 1);
  if (!bytes) return error("Incomplete recording fragment.", 400);
  if (!start && !matchesType(file.filename.split(".").pop()!, bytes.subarray(0, 64))) {
    return error("The file does not match its extension.", 400);
  }
  const final = end + 1 === total;
  try {
    let result = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Range": range }, body: bytes });
    // Graph returns 416 when a completed fragment is retried after a lost response.
    if (result.status === 416) {
      await result.body?.cancel();
      result = await fetch(uploadUrl);
    }
    if (result.status === 404 || result.status === 410) {
      // Graph closes a completed session. Recover the committed file by its
      // server-generated unique path when the final acknowledgement was lost.
      const item = final ? await findSharePointUpload(file.path) : null;
      if (item?.id && item.size === total) return { file, itemId: item.id };
      return error("The upload expired. Select the recording again.", 410);
    }
    if (!result.ok) return error("SharePoint could not accept this recording fragment.", 502);
    const data = await result.json();
    if (final && data.id && data.size === total) return { file, itemId: String(data.id) };
    if (!final && data.nextExpectedRanges?.some((next: string) => next.split("-")[0] === String(end + 1))) {
      return NextResponse.json({ nextOffset: end + 1 });
    }
    return error("SharePoint could not confirm the recording fragment.", 502);
  } catch {
    return error("SharePoint could not confirm the recording fragment.", 502);
  }
}
