// src/app/api/application-resume-versions/[id]/route.ts
// GET    -> single with full content
// PATCH  -> update content, formatting, status, ats_score, truth_score, one_page_fit_score
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
    data = await queryOne(
      `SELECT * FROM application_resume_versions WHERE id = $1`,
      [params.id]
    );
    error = data ? null : { message: "Not found" };
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("application_resume_versions")
      .select("*")
      .eq("id", params.id)
      .single();
    data = res.data;
    error = res.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  // application_resume_versions has no application_id column of its own - the
  // Falood studio page (and anywhere else navigating here purely by version id,
  // with no applicationId ever passed via the URL) needs one to drive the
  // packet-building feature (build packet / cover letter / recruiter message /
  // approve / mark sent), and was reading data.application_id, which has never
  // existed on this table - confirmed against the live schema, so that feature
  // has been silently non-functional whenever reached this way. Resolving it via
  // application_packets, which is the actual source of truth for this link -
  // checking both resume_version_id (used by /api/quick-application/falood-setup)
  // and final_resume_version_id (used by the older /api/application-packets
  // route, via TailorResumeModal.tsx) since different features created the link
  // through different columns.
  if (data) {
    const packet = isNeon()
      ? await queryOne<{ application_id: string }>(
          `SELECT application_id FROM application_packets WHERE resume_version_id = $1 OR final_resume_version_id = $1 LIMIT 1`,
          [params.id]
        )
      : await (async () => {
          const { supabase } = await import("@/lib/supabase");
          const res = await supabase
            .from("application_packets")
            .select("application_id")
            .or(`resume_version_id.eq.${params.id},final_resume_version_id.eq.${params.id}`)
            .limit(1)
            .maybeSingle();
          return res.data;
        })();
    data.application_id = packet?.application_id ?? null;
  }

  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const body = await req.json();
  const allowedFields = [
    "content", "formatting", "status", "ats_score", "truth_score", "one_page_fit_score",
    "title", "version_label", "generated_text", "source_resume_id",
  ];
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
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
      `UPDATE application_resume_versions SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`,
      values
    );
    error = data ? null : { message: "Update failed" };
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("application_resume_versions")
      .update(updates)
      .eq("id", params.id)
      .select()
      .single();
    data = res.data;
    error = res.error;
  }

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

  if (isNeon()) {
    const res = await execute(
      `DELETE FROM application_resume_versions WHERE id = $1`,
      [params.id]
    );
    error = res.rowCount === 0 ? { message: "Not found" } : null;
  } else {
    const { supabase } = await import("@/lib/supabase");
    const res = await supabase
      .from("application_resume_versions")
      .delete()
      .eq("id", params.id);
    error = res.error;
  }

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
