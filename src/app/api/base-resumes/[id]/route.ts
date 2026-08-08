// src/app/api/base-resumes/[id]/route.ts
// GET    -> single base resume (full content)
// PATCH  -> manual edits: name/target_industry/target_roles/status, or a direct
//           content edit (the human typing in the editor, not an AI-proposed change —
//           those go through apply-draft below so the conversation log stays accurate
//           about which edits were AI-proposed vs human-typed).
// DELETE -> remove (e.g. archived/unused draft)

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, DESTRUCTIVE_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { queryOne, execute } from "@/server/db/neon";
import { generateBaseResumeJobSearchProfile } from "@/server/services/baseResumeJobSearchKeywordService";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const data = await queryOne('SELECT * FROM base_resumes WHERE id = $1', [params.id]);
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const body = await req.json();
  if ("status" in body && !DESTRUCTIVE_MANAGER_ROLES.includes(context!.profile.role)) {
    return NextResponse.json({ error: "Only admin/manager can change base resume status." }, { status: 403 });
  }
  const allowedFields = ["name", "target_industry", "target_roles", "status", "content", "style_id"];
  const updates: Record<string, unknown> = { updated_by: context!.profile.user_id, updated_at: new Date().toISOString() };
  for (const f of allowedFields) {
    if (f in body) updates[f] = body[f];
  }
  if (body.status === "approved") updates.approved_by = context!.profile.user_id;

  let data: any;
  let error: any;

  const keys = Object.keys(updates);
  if (keys.length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const values = [...keys.map((k) => updates[k]), params.id] as (string | number | boolean | object | Date | null)[];
  data = await queryOne(
    `UPDATE base_resumes SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`,
    values
  );
  if (!data) return NextResponse.json({ error: "Update failed" }, { status: 500 });

  // If content changed, invalidate match scores for this candidate
  if (body.content && data?.candidate_id) {
    await execute('DELETE FROM job_match_scores WHERE candidate_id = $1', [data.candidate_id]);
  }

  if ((body.content || body.target_industry || body.target_roles) && data?.candidate_id) {
    try {
      await generateBaseResumeJobSearchProfile({
        baseResumeId: data.id,
        triggerType: "resume_updated",
        userId: context!.profile.user_id,
      });
    } catch (keywordError: any) {
      console.error("[BASE_RESUME_UPDATE] keyword agent failed", keywordError?.message || keywordError);
    }
  }

  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(DESTRUCTIVE_MANAGER_ROLES);
  if (response) return response;

  let error: any;

  const res = await execute('DELETE FROM base_resumes WHERE id = $1', [params.id]);
  if (res.rowCount === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
