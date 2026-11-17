import { NextResponse } from "next/server";
import { ASSIGNMENT_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { queryOne } from "@/server/db/neon";
import { resumePdfJobsAvailable } from "@/server/repositories/approvedResumePdfRepository";
import { TEMPORARY_RESUME_PDF_PROVIDER } from "@/server/storage/approvedResumePdfStorage";

export async function POST(_request: Request, { params }: { params: { id: string; exportId: string } }) {
  const { response } = await requireCurrentUser(ASSIGNMENT_MANAGER_ROLES);
  if (response) return response;
  if (!await resumePdfJobsAvailable()) return NextResponse.json({ error: "The archive queue is unavailable." }, { status: 409 });

  const scheduled = await queryOne(
    `WITH current_pdf AS MATERIALIZED (
      SELECT x.id FROM application_resume_exports x JOIN applications a ON a.id=x.application_id
      JOIN application_resume_versions v ON v.id=a.tailored_resume_version_id AND v.workflow_id=a.ai_workflow_id
      WHERE a.id=$1 AND x.id=$2 AND x.resume_version_id=v.id AND v.status='approved'
        AND x.id::text=v.release_receipt->>'exportId' AND x.content_sha256=v.release_receipt->>'pdfHash'
        AND x.status='created' AND x.export_type='pdf' AND x.storage_provider=$3 FOR UPDATE OF x
    ), reset AS (
      UPDATE application_resume_pdf_archive_jobs q SET state='pending',attempts=0,next_attempt_at=NOW(),last_error=NULL,
        lease_token=NULL,lease_until=NULL,updated_at=NOW()
      FROM current_pdf c WHERE q.export_id=c.id AND q.state='blocked' RETURNING q.export_id
    )
    UPDATE application_resume_exports x SET pdf_archive_state='pending' FROM reset WHERE x.id=reset.export_id RETURNING x.id`,
    [params.id, params.exportId, TEMPORARY_RESUME_PDF_PROVIDER],
  );
  if (!scheduled) return NextResponse.json({ error: "No blocked archive was found for the current approved PDF." }, { status: 409 });
  return NextResponse.json({ queued: true }, { status: 202 });
}
