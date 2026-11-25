import { sha256Hex } from "@/lib/sha256";
import { NextResponse } from "next/server";
import { requireCandidateContractAccess } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { backgroundDispatch } from "@/server/lib/waitUntil";
import { queryOne } from "@/server/db/neon";
import { downloadCandidateContract, isSharePointCandidateContractStorageKey } from "@/server/storage/candidateContractStorage";

export const dynamic = "force-dynamic";

function attachmentName(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f"\\]/g, "_").slice(0, 180) || "candidate-agreement";
}

function contentDisposition(mode: "inline" | "attachment", value: string): string {
  const safeName = attachmentName(value);
  const asciiName = safeName.replace(/[^\x20-\x7e]/g, "_");
  const encodedName = encodeURIComponent(safeName).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${mode}; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
}

export async function GET(req: Request, { params }: { params: { id: string; contractId: string } }) {
  const { context, response } = await requireCandidateContractAccess();
  if (response) return response;

  const file = await queryOne<{ storage_key: string; filename: string; content_type: string; candidate_name: string }>(
    `SELECT f.storage_key, f.filename, f.content_type, c.name AS candidate_name
       FROM candidate_contract_files f
       JOIN candidates c ON c.id = f.candidate_id
      WHERE f.id = $1 AND f.candidate_id = $2`,
    [params.contractId, params.id],
  );
  if (!file) {
    const signed=await queryOne<{pdf_base64:string;pdf_sha256:string}>("SELECT pdf_base64,pdf_sha256 FROM candidate_signed_contracts WHERE id=$1 AND candidate_id=$2",[params.contractId,params.id]);
    if(signed){
      const bytes=Buffer.from(signed.pdf_base64,'base64');
      if(await sha256Hex(bytes)!==signed.pdf_sha256)return NextResponse.json({error:"Document integrity check failed."},{status:503});
      return new Response(bytes,{headers:{"Content-Type":"application/pdf","Content-Disposition":contentDisposition(new URL(req.url).searchParams.get('view')==='inline'?'inline':'attachment','Skarion-signed-agreement.pdf'),"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
    }
  }
  if (!file) return NextResponse.json({ error: "Contract file not found." }, { status: 404 });
  if (!isSharePointCandidateContractStorageKey(file.storage_key) && !file.storage_key.startsWith(`candidate-contracts/${params.id}/`)) {
    return NextResponse.json({ error: "Contract file storage reference is invalid." }, { status: 500 });
  }

  try {
    const document = await downloadCandidateContract(file.storage_key);
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
    const wantsInlinePreview = new URL(req.url).searchParams.get("view") === "inline";
    const canPreviewInline = wantsInlinePreview && file.content_type === "application/pdf";
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": file.content_type,
        "Content-Disposition": contentDisposition(canPreviewInline ? "inline" : "attachment", file.filename),
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Could not retrieve the private contract file." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
