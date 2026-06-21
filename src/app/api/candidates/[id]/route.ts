// src/app/api/candidates/[id]/route.ts
// GET    -> candidate profile + their applications (with job info joined)
// PATCH  -> update candidate fields (incl. resume_url after upload)
// DELETE -> remove a candidate (cascades to their applications + resume variants)

import { NextRequest, NextResponse } from "next/server";
import { DESTRUCTIVE_MANAGER_ROLES, MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { triggerWebhooks } from "@/lib/webhookEngine";
import { deleteStorageFile } from "@/lib/storage";
import { isNeon } from "@/server/db";
import { query, queryOne, execute } from "@/server/db/neon";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (isNeon()) {
    try {
      const candidate = await queryOne<Record<string, any>>('SELECT * FROM candidates WHERE id = $1', [params.id]);
      if (!candidate) return NextResponse.json({ error: "Not found" }, { status: 404 });

      const applications = await query<Record<string, any>>(`
        SELECT a.*,
          jsonb_build_object('id', j.id, 'title', j.title, 'company', j.company, 'location', j.location, 'role_tier', j.role_tier) as jobs
        FROM applications a
        LEFT JOIN jobs j ON a.job_id = j.id
        WHERE a.candidate_id = $1
        ORDER BY a.applied_at DESC
      `, [params.id]);

      const resumes = await query<Record<string, any>>('SELECT * FROM resumes WHERE candidate_id = $1 ORDER BY created_at DESC', [params.id]);

      return NextResponse.json({ ...candidate, applications, resumes });
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  const { supabase } = await import("@/lib/supabase");
  const { data: candidate, error: candErr } = await supabase
    .from("candidates")
    .select("*")
    .eq("id", params.id)
    .single();

  if (candErr) return NextResponse.json({ error: candErr.message }, { status: 404 });

  // Pull applications for this candidate, joined with job details.
  const { data: applications, error: appErr } = await supabase
    .from("applications")
    .select("*, jobs(id, title, company, location, role_tier)")
    .eq("candidate_id", params.id)
    .order("applied_at", { ascending: false });

  if (appErr) return NextResponse.json({ error: appErr.message }, { status: 500 });

  const { data: resumes, error: resErr } = await supabase
    .from("resumes")
    .select("*")
    .eq("candidate_id", params.id)
    .order("created_at", { ascending: false });

  if (resErr) return NextResponse.json({ error: resErr.message }, { status: 500 });

  return NextResponse.json({ ...candidate, applications, resumes });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();

  const allowedFields = [
    "name", "email", "phone", "status", "target_tier",
    "notes", "resume_url", "resume_filename",
    "target_roles", "preferred_locations", "salary_expectation", "work_authorization",
    "linkedin_url", "github_url", "portfolio_url", "visa_status",
    "target_industries", "location_preference", "work_mode_preference", "available_start_date",
    "portal_token_expires_at", "portal_token_revoked_at",
  ];
  const updates: Record<string, unknown> = {};
  for (const f of allowedFields) {
    if (f in body) updates[f] = body[f];
  }

  if (isNeon()) {
    try {
      const keys = Object.keys(updates);
      if (keys.length === 0) {
        return NextResponse.json({ error: "No fields to update" }, { status: 400 });
      }
      const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
      const values = Object.values(updates) as (string | number | boolean | object | Date | null)[];
      values.push(params.id);
      const sql = `UPDATE candidates SET ${setClause}, updated_at = NOW() WHERE id = $${keys.length + 1} RETURNING *`;
      const data = await queryOne<Record<string, any>>(sql, values);
      if (!data) throw new Error("Update failed");

      if (context && data) {
        await logActivity({
          userId: context.profile.user_id,
          actorName: context.profile.display_name || context.profile.email || undefined,
          type: "update",
          description: `Updated candidate ${data.name}`,
          entityType: "candidate",
          entityId: params.id,
          entityName: data.name,
          metadata: { fields: Object.keys(updates) },
        });
        void triggerWebhooks("candidate.updated", {
          candidate_id: params.id,
          updates: Object.keys(updates),
          updated_by: context.profile.user_id,
        });
      }

      return NextResponse.json(data);
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  const { supabase } = await import("@/lib/supabase");
  const { data, error } = await supabase
    .from("candidates")
    .update(updates)
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (context && data) {
    await logActivity({
      userId: context.profile.user_id,
      actorName: context.profile.display_name || context.profile.email || undefined,
      type: "update",
      description: `Updated candidate ${data.name}`,
      entityType: "candidate",
      entityId: params.id,
      entityName: data.name,
      metadata: { fields: Object.keys(updates) },
    });
    void triggerWebhooks("candidate.updated", {
      candidate_id: params.id,
      updates: Object.keys(updates),
      updated_by: context.profile.user_id,
    });
  }

  return NextResponse.json(data);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(DESTRUCTIVE_MANAGER_ROLES);
  if (response) return response;

  if (isNeon()) {
    try {
      const candidate = await queryOne<{ resume_url: string | null; avatar_url: string | null; name: string | null }>(
        'SELECT resume_url, avatar_url, name FROM candidates WHERE id = $1',
        [params.id]
      );
      const resumes = await query<{ file_url: string | null }>('SELECT file_url FROM resumes WHERE candidate_id = $1', [params.id]);

      await execute('DELETE FROM candidates WHERE id = $1', [params.id]);

      await Promise.all([
        deleteStorageFile(candidate?.resume_url),
        deleteStorageFile(candidate?.avatar_url),
        ...(resumes ?? []).map((r: any) => deleteStorageFile(r.file_url)),
      ]);

      if (context) {
        await logActivity({
          userId: context.profile.user_id,
          actorName: context.profile.display_name || context.profile.email || undefined,
          type: "delete",
          description: `Deleted candidate ${candidate?.name || params.id}`,
          entityType: "candidate",
          entityId: params.id,
          entityName: candidate?.name || undefined,
        });
        void triggerWebhooks("candidate.deleted", {
          candidate_id: params.id,
          name: candidate?.name || null,
          deleted_by: context.profile.user_id,
        });
      }

      return NextResponse.json({ ok: true });
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  const { supabase } = await import("@/lib/supabase");
  const [{ data: candidate }, { data: resumes }] = await Promise.all([
    supabase.from("candidates").select("resume_url, avatar_url, name").eq("id", params.id).single(),
    supabase.from("resumes").select("file_url").eq("candidate_id", params.id),
  ]);

  const { error } = await supabase.from("candidates").delete().eq("id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await Promise.all([
    deleteStorageFile(candidate?.resume_url),
    deleteStorageFile(candidate?.avatar_url),
    ...(resumes ?? []).map((r: any) => deleteStorageFile(r.file_url)),
  ]);

  if (context) {
    await logActivity({
      userId: context.profile.user_id,
      actorName: context.profile.display_name || context.profile.email || undefined,
      type: "delete",
      description: `Deleted candidate ${candidate?.name || params.id}`,
      entityType: "candidate",
      entityId: params.id,
      entityName: candidate?.name || undefined,
    });
    void triggerWebhooks("candidate.deleted", {
      candidate_id: params.id,
      name: candidate?.name || null,
      deleted_by: context.profile.user_id,
    });
  }

  return NextResponse.json({ ok: true });
}
