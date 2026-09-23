// src/app/api/application-resume-versions/[id]/duplicate/route.ts
// POST -> copy an application resume version into a new, unlinked draft.
// Deliberately does NOT carry over application_id/job_id/workflow_id: those
// tie a version to one specific application/AI workflow run (workflow_id has
// a unique index per source_type='ai_agent' - see
// sql/neon_fixes/014_workflow_finalization_unique.sql), and a duplicate is a
// fresh, unattached copy for the user to repurpose, not a second row for the
// same application. Scores are reset since they describe a specific review
// pass, not the content itself.

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { queryOne } from "@/server/db/neon";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const source = await queryOne<any>(
    `SELECT * FROM application_resume_versions WHERE id = $1`,
    [params.id]
  );
  if (!source) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const title = source.title ? `${source.title} (Copy)` : "Copy";

  const data = await queryOne(
    `INSERT INTO application_resume_versions
       (candidate_id, base_resume_id, target_job_id, content, formatting, status,
        source_type, title, version_label, source_resume_id, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, 'draft', $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      source.candidate_id,
      source.base_resume_id,
      source.target_job_id,
      JSON.stringify(source.content),
      source.formatting ? JSON.stringify(source.formatting) : null,
      source.source_type,
      title,
      source.version_label,
      source.source_resume_id,
      context!.profile.user_id,
    ]
  );
  if (!data) return NextResponse.json({ error: "Duplicate failed" }, { status: 500 });

  await logActivity({
    userId: context!.profile.user_id,
    actorName: context!.profile.display_name || context!.profile.email || undefined,
    type: "create",
    description: `Duplicated application resume version into "${title}"`,
    entityType: "application_resume_version",
    entityId: (data as any).id,
    entityName: title,
    metadata: { duplicated_from: params.id },
  });

  return NextResponse.json(data, { status: 201 });
}
