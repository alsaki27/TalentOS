// src/app/api/base-resumes/[id]/apply-draft/route.ts
// POST -> commit an AI-proposed ResumeDocument (returned from /api/falood/command as
// a FaloodAction) into base_resumes.content. This is the ONLY place an AI-proposed
// resume change actually gets saved — the explicit user click that turns "AI suggests"
// into "system tracks," matching this app's existing accept/reject conventions
// elsewhere (resume suggestions in Phase 4 follow the same shape).

import { NextRequest, NextResponse } from "next/server";
import { APPLICATION_WORKER_ROLES, requireCurrentUser } from "@/lib/auth";
import { queryOne } from "@/server/db/neon";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(APPLICATION_WORKER_ROLES);
  if (response) return response;

  const body = await req.json();
  const newContent = body.newContent;
  if (!newContent) return NextResponse.json({ error: "newContent is required" }, { status: 400 });

  const data = await queryOne<any>(`UPDATE base_resumes SET content = $1, updated_by = $2, updated_at = $3 WHERE id = $4 RETURNING *`, [newContent, context!.profile.user_id, new Date().toISOString(), params.id]);
  return NextResponse.json(data);
}
