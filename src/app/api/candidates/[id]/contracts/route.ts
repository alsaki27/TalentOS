import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { backgroundDispatch } from "@/server/lib/waitUntil";
import { query, queryOne } from "@/server/db/neon";
import { deletePrivateCandidateContract, uploadPrivateCandidateContract } from "@/server/storage/storageApi";

export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MIME_BY_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function safeFilename(value: string): string {
  const basename = value.replace(/\\/g, "/").split("/").pop() || "agreement";
  return basename.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 180) || "agreement";
}

function hasExpectedFileSignature(extension: string, bytes: Uint8Array): boolean {
  if (extension === ".pdf") return new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
  if (extension === ".docx") return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (extension === ".doc") return bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
  return false;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;
  try {
    const files = await query<Record<string, unknown>>(
      `SELECT id, filename, content_type, size_bytes, uploaded_by, created_at
         FROM candidate_contract_files
        WHERE candidate_id = $1
        ORDER BY created_at DESC, id DESC`,
      [params.id],
    );
    return NextResponse.json({ files }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load contract files. Apply the candidate onboarding schema first." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > MAX_FILE_BYTES + 1024 * 1024) {
    return NextResponse.json({ error: "Contract files must be 20 MB or smaller." }, { status: 413 });
  }

  let fileKey: string | null = null;
  try {
    const candidate = await queryOne<{ id: string; name: string }>("SELECT id, name FROM candidates WHERE id = $1", [params.id]);
    if (!candidate) return NextResponse.json({ error: "Candidate not found." }, { status: 404 });

    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "Choose a contract PDF or Word document." }, { status: 400 });
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "Contract files must be 20 MB or smaller." }, { status: 413 });
    }

    const filename = safeFilename(file.name);
    const extension = filename.slice(filename.lastIndexOf(".")).toLowerCase();
    const contentType = MIME_BY_EXTENSION[extension];
    if (!contentType) return NextResponse.json({ error: "Only PDF, DOC, and DOCX files are accepted." }, { status: 415 });

    const buffer = new Uint8Array(await file.arrayBuffer());
    if (!hasExpectedFileSignature(extension, buffer)) {
      return NextResponse.json({ error: "The selected file does not match its PDF or Word file extension." }, { status: 415 });
    }

    fileKey = `candidate-contracts/${params.id}/${globalThis.crypto.randomUUID()}${extension}`;
    await uploadPrivateCandidateContract(fileKey, buffer, contentType);

    const saved = await queryOne<Record<string, unknown>>(
      `WITH inserted AS (
         INSERT INTO candidate_contract_files (candidate_id, filename, storage_key, content_type, size_bytes, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, filename, content_type, size_bytes, uploaded_by, created_at
       ), marked AS (
         UPDATE candidates SET has_contract = TRUE, updated_at = NOW()
          WHERE id = $1 AND EXISTS (SELECT 1 FROM inserted)
         RETURNING id
       )
       SELECT inserted.* FROM inserted JOIN marked ON TRUE`,
      [params.id, filename, fileKey, contentType, file.size, context.profile.user_id],
    );
    if (!saved) throw new Error("Contract record was not saved.");

    backgroundDispatch(logActivity({
      userId: context.profile.user_id,
      actorName: context.profile.display_name || context.profile.email || undefined,
      type: "create",
      description: `Uploaded a contract file for ${candidate.name}`,
      entityType: "candidate",
      entityId: params.id,
      entityName: candidate.name,
    }));

    return NextResponse.json({ file: saved, has_contract: true }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (fileKey) {
      await deletePrivateCandidateContract(fileKey).catch(() => {});
    }
    const message = error instanceof Error ? error.message : "";
    if ((error as { code?: unknown }) && (error as { code?: unknown }).code === "42P01") {
      return NextResponse.json({ error: "Candidate contract schema is not applied yet." }, { status: 503 });
    }
    if (message.includes("Private candidate contract storage") || message.includes("R2 credentials")) {
      return NextResponse.json({ error: "Private contract storage is not configured yet." }, { status: 503 });
    }
    console.error("[Candidate contracts] Upload failed.", message);
    return NextResponse.json({ error: "Could not upload the contract file." }, { status: 500 });
  }
}
