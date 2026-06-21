// src/app/api/applications/[id]/close/route.ts
// PATCH -> close application. Body: submissionUrl?, closeNote?, proofRequired?

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { isNeon } from "@/server/db";
import { query, queryOne, execute } from "@/server/db/neon";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const body = await req.json();
  const submissionUrl = body.submissionUrl as string | undefined;
  const closeNote = body.closeNote as string | undefined;
  const proofRequired = body.proofRequired as boolean | undefined;

  let existingApplication;
  if (isNeon()) {
    existingApplication = await queryOne<{ proof_required: boolean | null }>(
      'SELECT proof_required FROM applications WHERE id = $1',
      [params.id]
    );
  } else {
    const { supabase } = await import("@/lib/supabase");
    const { data } = await supabase
      .from("applications")
      .select("proof_required")
      .eq("id", params.id)
      .single();
    existingApplication = data;
  }
  const requiresProof = proofRequired ?? existingApplication?.proof_required ?? false;

  if (requiresProof) {
    let count: number | null = null;
    if (isNeon()) {
      const row = await queryOne<{ count: number }>(
        'SELECT COUNT(*)::int as count FROM application_proofs WHERE application_id = $1',
        [params.id]
      );
      count = row?.count ?? null;
    } else {
      const { supabase } = await import("@/lib/supabase");
      const { count: c } = await supabase
        .from("application_proofs")
        .select("id", { count: "exact", head: true })
        .eq("application_id", params.id);
      count = c;
    }
    if (!count) {
      return NextResponse.json(
        { error: "Proof of submission is required before closing this ticket. Upload a screenshot first." },
        { status: 400 },
      );
    }
  }

  const updates: Record<string, unknown> = {
    status: "closed",
    completed_at: new Date().toISOString(),
  };

  if (submissionUrl !== undefined) updates.submission_url = submissionUrl;
  if (proofRequired !== undefined) updates.proof_required = proofRequired;
  if (closeNote !== undefined) {
    let existing;
    if (isNeon()) {
      existing = await queryOne<{ notes: string | null }>(
        'SELECT notes FROM applications WHERE id = $1',
        [params.id]
      );
    } else {
      const { supabase } = await import("@/lib/supabase");
      const { data } = await supabase
        .from("applications")
        .select("notes")
        .eq("id", params.id)
        .single();
      existing = data;
    }
    const existingNotes = existing?.notes ? existing.notes + "\n\n" : "";
    updates.notes = existingNotes + `[Closed] ${closeNote}`;
  }

  let data;
  if (isNeon()) {
    const keys = Object.keys(updates);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const values = Object.values(updates) as (string | number | boolean | object | Date | null)[];
    values.push(params.id);
    data = await queryOne<Record<string, any>>(
      `UPDATE applications SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`,
      values
    );
    if (!data) return NextResponse.json({ error: "Update failed" }, { status: 500 });
  } else {
    const { supabase } = await import("@/lib/supabase");
    const { data: d, error } = await supabase
      .from("applications")
      .update(updates)
      .eq("id", params.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    data = d;
  }

  if (context) {
    await logActivity({
      userId: context.profile.user_id,
      actorName: context.profile.display_name || context.profile.email || undefined,
      type: "update",
      description: `Closed application ${params.id}`,
      entityType: "application",
      entityId: params.id,
      metadata: { submission_url: submissionUrl, proof_required: proofRequired },
    });
  }

  return NextResponse.json(data);
}
