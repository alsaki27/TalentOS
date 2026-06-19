// src/app/api/applications/[id]/keywords/route.ts
// GET  -> list keywords for an application
// PATCH -> bulk update keyword statuses

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { listApplicationKeywords, bulkUpdateApplicationKeywordStatuses } from "@/server/repositories/applicationKeywordsRepository";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  try {
    const keywords = await listApplicationKeywords(params.id);
    return NextResponse.json({ keywords });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load keywords" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const body = await req.json();
  const updates = body.updates;

  if (!Array.isArray(updates) || updates.length === 0) {
    return NextResponse.json({ error: "updates array is required" }, { status: 400 });
  }

  try {
    const results = await bulkUpdateApplicationKeywordStatuses(
      updates.map((u: any) => ({
        id: u.id,
        status: u.status,
        user_reason: u.user_reason ?? null,
        reviewed_by: context!.profile.user_id,
      }))
    );

    await logActivity({
      userId: context!.profile.user_id,
      actorName: context!.profile.display_name || context!.profile.email || undefined,
      type: "update",
      description: `Updated ${results.length} keyword status(es) for application ${params.id}`,
      entityType: "application_job_keywords",
      entityId: params.id,
      metadata: { updates: updates.map((u: any) => ({ id: u.id, status: u.status })) },
    });

    return NextResponse.json({ keywords: results });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to update keywords" }, { status: 500 });
  }
}
