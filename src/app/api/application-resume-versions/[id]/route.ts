// src/app/api/application-resume-versions/[id]/route.ts
// GET    -> single with full content
// PATCH  -> update content, formatting, status, ats_score, truth_score, one_page_fit_score, page_fit_metrics
// DELETE -> delete (admin only)

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, DESTRUCTIVE_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { queryOne, execute } from "@/server/db/neon";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  let data: any;
  let error: any;

  data = await queryOne(
    `SELECT * FROM application_resume_versions WHERE id = $1`,
    [params.id]
  );
  error = data ? null : { message: "Not found" };

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  if (data) {
    const packet = await queryOne<{ application_id: string }>(
      `SELECT application_id FROM application_packets
       WHERE resume_version_id = $1 OR final_resume_version_id = $1
       LIMIT 1`,
      [params.id]
    );

    // Newer rows carry the application ID directly. Preserve it; the previous
    // packet-only enrichment overwrote it with null for rows that had not yet
    // been attached to a packet, which silently disabled SharePoint archiving
    // in the browser export path.
    data.application_id = data.application_id ?? packet?.application_id ?? null;

    // Older rows may have neither the direct link nor a packet yet. Resolve the
    // application deterministically from the resume's candidate + target job so
    // an export never falls back to a download-only path when a matching ticket
    // already exists.
    if (!data.application_id && data.candidate_id && data.target_job_id) {
      const inferred = await queryOne<{ id: string }>(
        `SELECT a.id
         FROM applications a
         JOIN target_jobs tj ON tj.job_id = a.job_id
         WHERE a.candidate_id = $1
           AND tj.id = $2
         ORDER BY a.applied_at DESC NULLS LAST, a.created_at DESC NULLS LAST
         LIMIT 1`,
        [data.candidate_id, data.target_job_id]
      );
      data.application_id = inferred?.id ?? null;
    }
  }

  // Neon returns JSONB columns as raw strings. The studio page and other
  // callers expect objects, not serialized JSON strings — normalize here so
  // downstream JSON.parse(JSON.stringify(...)) doesn't pass a string through.
  if (data) {
    if (typeof data.content === "string") {
      try { data.content = JSON.parse(data.content); } catch { /* leave as-is */ }
    }
    if (typeof data.formatting === "string") {
      try { data.formatting = JSON.parse(data.formatting); } catch { /* leave as-is */ }
    }
  }

  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const body = await req.json();
  const allowedFields = [
    "content", "formatting", "status", "ats_score", "truth_score", "one_page_fit_score", "page_fit_metrics",
    "title", "version_label", "generated_text", "source_resume_id",
  ];
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const f of allowedFields) {
    if (f in body) updates[f] = body[f];
  }

  let data: any;
  let error: any;

  const keys = Object.keys(updates);
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = [...keys.map((k) => updates[k]), params.id] as (string | number | boolean | object | Date | null)[];
  data = await queryOne(
    `UPDATE application_resume_versions SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`,
    values
  );
  error = data ? null : { message: "Update failed" };

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (context) {
    await logActivity({
      userId: context.profile.user_id,
      actorName: context.profile.display_name || context.profile.email || undefined,
      type: "update",
      description: `Updated application resume version ${params.id}`,
      entityType: "application_resume_version",
      entityId: params.id,
      metadata: { fields: Object.keys(updates) },
    });
  }

  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(DESTRUCTIVE_MANAGER_ROLES);
  if (response) return response;

  let error: any;

  const res = await execute(
    `DELETE FROM application_resume_versions WHERE id = $1`,
    [params.id]
  );
  error = res.rowCount === 0 ? { message: "Not found" } : null;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (context) {
    await logActivity({
      userId: context.profile.user_id,
      actorName: context.profile.display_name || context.profile.email || undefined,
      type: "delete",
      description: `Deleted application resume version ${params.id}`,
      entityType: "application_resume_version",
      entityId: params.id,
    });
  }

  return NextResponse.json({ ok: true });
}
