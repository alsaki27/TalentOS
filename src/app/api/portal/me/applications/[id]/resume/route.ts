import { NextResponse } from "next/server";
import { requireCurrentCandidate } from "@/server/auth/candidateAuth";
import { queryOne } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentCandidate();
  if (response) return response;

  const resume = await queryOne<any>(
    `SELECT rv.id, rv.title, rv.version_label, rv.generated_text, rv.content, rv.updated_at, rv.created_at,
            rv.status AS resume_status, packet.packet_status
     FROM applications a
     JOIN application_resume_versions rv ON rv.id = a.tailored_resume_version_id
     LEFT JOIN application_packets packet ON packet.application_id = a.id AND packet.final_resume_version_id = rv.id
     WHERE a.id = $1
       AND a.candidate_id = $2
       AND a.resume_generation_status = 'ready'
       AND rv.application_id = a.id
       AND rv.candidate_id = a.candidate_id
       -- Candidate visibility is governed by the finalized application/workflow
       -- state. Older finalized rows can lack a packet or retain draft even
       -- though the application already points at the completed version.
       AND (
         rv.status IN ('approved', 'final')
         OR packet.packet_status IN ('approved', 'sent')
         OR (a.resume_generation_status = 'ready' AND rv.content IS NOT NULL)
       )`,
    [params.id, context.candidateId],
  );

  if (!resume) return NextResponse.json({ error: "Tailored resume is not ready" }, { status: 404 });
  let content = resume.content;
  if (typeof content === "string") {
    try { content = JSON.parse(content); } catch { /* preserve invalid legacy content for diagnostics */ }
  }

  return NextResponse.json({
    id: resume.id,
    title: resume.title || "Tailored resume",
    version_label: resume.version_label,
    generated_text: resume.generated_text,
    content,
    approved: true,
    updated_at: resume.updated_at || resume.created_at,
  });
}
