import { NextRequest, NextResponse } from "next/server";
import { queryOne } from "@/server/db/neon";
import { requireCandidateByToken } from "@/lib/portalAuth";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const { candidate, response } = await requireCandidateByToken(params.token);
  if (response) return response;

  const url = new URL(req.url);
  const applicationId = url.searchParams.get("applicationId");
  if (!applicationId) {
    return NextResponse.json({ error: "applicationId is required" }, { status: 400 });
  }

  const app = await queryOne<{ id: string; candidate_id: string }>(
    `SELECT id, candidate_id FROM applications WHERE id = $1`,
    [applicationId]
  );

  if (!app || app.candidate_id !== candidate.id) {
    return NextResponse.json({ error: "Application not found" }, { status: 404 });
  }

  const packet = await queryOne<{ final_resume_version_id: string | null }>(
    `SELECT final_resume_version_id FROM application_packets WHERE application_id = $1 LIMIT 1`,
    [applicationId]
  );

  let resumeVersion: {
    id: string;
    content: Record<string, unknown> | null;
  } | null = null;

  if (packet?.final_resume_version_id) {
    resumeVersion = await queryOne<{ id: string; content: Record<string, unknown> | null }>(
      `SELECT id, content FROM application_resume_versions WHERE id = $1`,
      [packet.final_resume_version_id]
    );
  } else {
    resumeVersion = await queryOne<{ id: string; content: Record<string, unknown> | null }>(
      `SELECT id, content FROM application_resume_versions WHERE candidate_id = $1 AND status = 'final' ORDER BY created_at DESC LIMIT 1`,
      [candidate.id]
    );
  }

  if (!resumeVersion?.content) {
    return NextResponse.json({ error: "No resume found for this application" }, { status: 404 });
  }

  const resumeContent =
    typeof resumeVersion.content === "string"
      ? resumeVersion.content
      : JSON.stringify(resumeVersion.content, null, 2);

  const filename = `resume-${candidate.name.replace(/\s+/g, "_")}.json`;

  return new NextResponse(resumeContent, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
