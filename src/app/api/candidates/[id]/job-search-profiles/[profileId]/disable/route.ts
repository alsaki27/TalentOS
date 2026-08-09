import { NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { queryOne } from "@/server/db/neon";

export async function POST(request: Request, { params }: { params: { id: string; profileId: string } }) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;
  const body = await request.json().catch(() => ({})) as { disabled?: unknown };
  const disabled = body.disabled !== false;
  const profile = await queryOne<any>(
    `UPDATE candidate_resume_search_profiles p
        SET review_status = CASE WHEN $1 THEN 'disabled' ELSE 'pending' END,
            disabled_at = CASE WHEN $1 THEN NOW() ELSE NULL END,
            approved_by = NULL, approved_at = NULL, approved_profile_version = NULL,
            updated_by = $2, updated_at = NOW()
       FROM candidates c
      WHERE p.id = $3 AND p.candidate_id = $4 AND c.id = p.candidate_id
        AND lower(c.status) = 'active'
      RETURNING p.*`,
    [disabled, context!.profile.user_id, params.profileId, params.id],
  );
  if (!profile) return NextResponse.json({ error: "Active search profile not found" }, { status: 404 });
  return NextResponse.json({ profile });
}
