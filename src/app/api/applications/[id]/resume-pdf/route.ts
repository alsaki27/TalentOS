import { NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { archivedPdfResponse, findLatestArchivedPdf } from "@/server/services/resumeExportArchiveService";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;
  const record = await findLatestArchivedPdf(params.id);
  if (!record) return NextResponse.json({ error: "No archived PDF exists for this application yet." }, { status: 404 });
  try { return await archivedPdfResponse(record); }
  catch (err: any) { return NextResponse.json({ error: err?.message || "Archived PDF could not be loaded." }, { status: 502 }); }
}
