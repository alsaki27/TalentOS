import { NextResponse } from "next/server";
import { requireCurrentCandidate } from "@/server/auth/candidateAuth";
import { queryOne } from "@/server/db/neon";
import { sha256Hex } from "@/lib/sha256";
export const dynamic = "force-dynamic";
export async function GET() {
  const { context, response } = await requireCurrentCandidate({
    allowIncompleteOnboarding: true,
  });
  if (response) return response;
  const file = await queryOne<{ pdf_base64: string; pdf_sha256: string }>(
    "SELECT pdf_base64,pdf_sha256 FROM candidate_signed_contracts WHERE candidate_id=$1 ORDER BY signed_at DESC LIMIT 1",
    [context.candidateId],
  );
  if (!file)
    return NextResponse.json(
      { error: "No signed agreement found." },
      { status: 404 },
    );
  const bytes = Buffer.from(file.pdf_base64, "base64");
  if ((await sha256Hex(bytes)) !== file.pdf_sha256)
    return NextResponse.json(
      { error: "Document integrity check failed." },
      { status: 503 },
    );
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition":
        'attachment; filename="Skarion-signed-agreement.pdf"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
