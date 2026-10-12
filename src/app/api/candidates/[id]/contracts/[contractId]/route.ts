import { NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { backgroundDispatch } from "@/server/lib/waitUntil";
import { queryOne } from "@/server/db/neon";
import { downloadPrivateCandidateContract } from "@/server/storage/storageApi";

export const dynamic = "force-dynamic";

function attachmentName(value: string): string {
  return value.replace(/[\r\n"\\]/g, "_").slice(0, 180) || "candidate-agreement";
}

export async function GET(_req: Request, { params }: { params: { id: string; contractId: string } }) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const file = await queryOne<{ storage_key: string; filename: string; content_type: string; candidate_name: string }>(
    `SELECT f.storage_key, f.filename, f.content_type, c.name AS candidate_name
       FROM candidate_contract_files f
       JOIN candidates c ON c.id = f.candidate_id
      WHERE f.id = $1 AND f.candidate_id = $2`,
    [params.contractId, params.id],
  );
  if (!file) return NextResponse.json({ error: "Contract file not found." }, { status: 404 });
  if (!file.storage_key.startsWith(`candidate-contracts/${params.id}/`)) {
    return NextResponse.json({ error: "Contract file storage reference is invalid." }, { status: 500 });
  }

  try {
    const document = await downloadPrivateCandidateContract(file.storage_key);
    backgroundDispatch(logActivity({
      userId: context.profile.user_id,
      actorName: context.profile.display_name || context.profile.email || undefined,
      type: "view",
      description: `Viewed a private contract file for ${file.candidate_name}`,
      entityType: "candidate",
      entityId: params.id,
      entityName: file.candidate_name,
    }));
    const body = document.buffer.buffer.slice(
      document.buffer.byteOffset,
      document.buffer.byteOffset + document.buffer.byteLength,
    ) as ArrayBuffer;
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": file.content_type,
        "Content-Disposition": `attachment; filename="${attachmentName(file.filename)}"`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Could not retrieve the private contract file." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
