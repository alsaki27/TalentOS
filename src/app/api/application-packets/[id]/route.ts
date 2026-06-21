// src/app/api/application-packets/[id]/route.ts
// GET    -> single packet
// PATCH  -> update any fields
// DELETE -> delete (admin only)

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, DESTRUCTIVE_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { isNeon } from "@/server/db";
import { queryOne, execute } from "@/server/db/neon";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  let data: any;
  let error: any;

  if (isNeon()) {
    const row = await queryOne<any>(
      `SELECT ap.*, a.status as application_status, a.review_status as application_review_status, a.review_note as application_review_note, j.title as job_title, j.company as job_company FROM application_packets ap LEFT JOIN applications a ON a.id = ap.application_id LEFT JOIN jobs j ON j.id = a.job_id WHERE ap.application_id = $1`,
      [params.id]
    );
    if (row) {
      const { application_status, application_review_status, application_review_note, job_title, job_company, ...rest } = row;
      data = {
        ...rest,
        applications: {
          status: application_status,
          review_status: application_review_status,
          review_note: application_review_note,
          jobs: {
            title: job_title,
            company: job_company,
          },
        },
      };
      error = null;
    } else {
      data = null;
      error = { message: "Not found" };
    }
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("application_packets")
      .select("*, applications(status, review_status, review_note, jobs(title, company))")
      .eq("application_id", params.id)
      .single();
    data = res.data;
    error = res.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const body = await req.json();
  const allowedFields = [
    "base_resume_id", "target_job_id", "final_resume_version_id",
    "approved_keyword_ids", "rejected_keyword_ids",
    "cover_letter", "recruiter_message", "hiring_manager_email", "interview_prep_notes",
  ];
  const updates: Record<string, unknown> = {};
  for (const f of allowedFields) {
    if (f in body) updates[f] = body[f];
  }

  let data: any;
  let error: any;

  if (isNeon()) {
    const keys = Object.keys(updates);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const values = [...keys.map((k) => updates[k]), params.id] as (string | number | boolean | object | Date | null)[];
    data = await queryOne(
      `UPDATE application_packets SET ${setClause} WHERE application_id = $${keys.length + 1} RETURNING *`,
      values
    );
    error = data ? null : { message: "Update failed" };
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("application_packets")
      .update(updates)
      .eq("application_id", params.id)
      .select()
      .single();
    data = res.data;
    error = res.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (context) {
    if ("final_resume_version_id" in updates) {
      await logActivity({
        userId: context.profile.user_id,
        actorName: context.profile.display_name || context.profile.email || undefined,
        type: "update",
        description: `Attached resume variant to application packet ${params.id}`,
        entityType: "application_packet",
        entityId: params.id,
        metadata: { application_id: params.id, final_resume_version_id: updates.final_resume_version_id },
      });
    }

    await logActivity({
      userId: context.profile.user_id,
      actorName: context.profile.display_name || context.profile.email || undefined,
      type: "update",
      description: `Updated application packet for application ${params.id}`,
      entityType: "application_packet",
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

  if (isNeon()) {
    const res = await execute(
      `DELETE FROM application_packets WHERE application_id = $1`,
      [params.id]
    );
    error = res.rowCount === 0 ? { message: "Not found" } : null;
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("application_packets")
      .delete()
      .eq("application_id", params.id);
    error = res.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (context) {
    await logActivity({
      userId: context.profile.user_id,
      actorName: context.profile.display_name || context.profile.email || undefined,
      type: "delete",
      description: `Deleted application packet for application ${params.id}`,
      entityType: "application_packet",
      entityId: params.id,
    });
  }

  return NextResponse.json({ ok: true });
}
