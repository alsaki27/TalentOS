import { NextResponse } from "next/server";
import { requireCurrentCandidate } from "@/server/auth/candidateAuth";
import { queryOne } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentCandidate();
  if (response) return response;

  const resume = await queryOne<any>(
    `SELECT rv.id, rv.title, rv.version_label, rv.generated_text, rv.content, rv.updated_at, rv.created_at,
            rv.status AS resume_status, packet.packet_status,
            EXISTS(SELECT 1 FROM application_resume_exports e WHERE e.application_id = a.id AND e.resume_version_id = rv.id AND e.export_type = 'pdf' AND e.status = 'created') AS pdf_available
     FROM applications a
     JOIN application_resume_versions rv ON rv.id = a.tailored_resume_version_id
     LEFT JOIN application_packets packet ON packet.application_id = a.id AND packet.final_resume_version_id = rv.id
     WHERE a.id = $1
       AND a.candidate_id = $2
       AND a.resume_generation_status = 'ready'
       AND rv.application_id = a.id
       AND rv.candidate_id = a.candidate_id
       AND (rv.status IN ('approved', 'final') OR packet.packet_status IN ('approved', 'sent') OR rv.content IS NOT NULL)`,
    [params.id, context.candidateId],
  );

  if (!resume) return NextResponse.json({ error: "Tailored resume is not ready" }, { status: 404 });
  let content = resume.content;
  if (typeof content === "string") {
    try { content = JSON.parse(content); } catch { /* preserve invalid legacy content for diagnostics */ }
  }

  return NextResponse.json({
    id: resume.id,
    application_id: params.id,
    title: resume.title || "Tailored resume",
    version_label: resume.version_label,
    generated_text: resume.generated_text,
    content,
    approved: true,
    pdf_available: Boolean(resume.pdf_available),
    updated_at: resume.updated_at || resume.created_at,
  });
}
