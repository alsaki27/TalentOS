import { NextResponse } from "next/server";
import { requireCurrentCandidate } from "@/server/auth/candidateAuth";
import { archivedPdfResponse, findLatestArchivedPdf } from "@/server/services/resumeExportArchiveService";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentCandidate();
  if (response) return response;
  const record = await findLatestArchivedPdf(params.id, context.candidateId);
  if (!record) return NextResponse.json({ error: "Your tailored PDF is not available yet." }, { status: 404 });
  try { return await archivedPdfResponse(record); }
  catch (err: any) { return NextResponse.json({ error: err?.message || "Tailored PDF could not be loaded." }, { status: 502 }); }
}
