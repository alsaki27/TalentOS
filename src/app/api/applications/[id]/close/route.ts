// src/app/api/applications/[id]/close/route.ts
// PATCH -> close application. Body: submissionUrl?, closeNote?, proofRequired?

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { logActivity } from "@/lib/activity";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const body = await req.json();
  const submissionUrl = body.submissionUrl as string | undefined;
  const closeNote = body.closeNote as string | undefined;
  const proofRequired = body.proofRequired as boolean | undefined;

  const { data: existingApplication } = await supabase
    .from("applications")
    .select("proof_required")
    .eq("id", params.id)
    .single();
  const requiresProof = proofRequired ?? existingApplication?.proof_required ?? false;

  if (requiresProof) {
    const { count } = await supabase
      .from("application_proofs")
      .select("id", { count: "exact", head: true })
      .eq("application_id", params.id);
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
    const { data: existing } = await supabase
      .from("applications")
      .select("notes")
      .eq("id", params.id)
      .single();
    const existingNotes = existing?.notes ? existing.notes + "\n\n" : "";
    updates.notes = existingNotes + `[Closed] ${closeNote}`;
  }

  const { data, error } = await supabase
    .from("applications")
    .update(updates)
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

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
