import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser, MASTER_DATA_MANAGER_ROLES } from "@/lib/auth";
import { queryOne } from "@/server/db/neon";
import { logActivity } from "@/lib/activity";
import { PORTAL_TOKEN_DEFAULT_TTL_DAYS } from "@/lib/portalAuth";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  let ttlDays = PORTAL_TOKEN_DEFAULT_TTL_DAYS;
  try {
    const body = await req.json();
    if (body.ttlDays && typeof body.ttlDays === "number" && body.ttlDays > 0) {
      ttlDays = body.ttlDays;
    }
  } catch {}

  const candidate = await queryOne<{ id: string; name: string; portal_token: string }>(
    `UPDATE candidates
     SET portal_token = gen_random_uuid(),
         portal_token_revoked_at = NULL,
         portal_token_expires_at = now() + ($1 || ' days')::interval
     WHERE id = $2
     RETURNING id, name, portal_token`,
    [String(ttlDays), params.id]
  );

  if (!candidate) {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }

  await logActivity({
    userId: context.profile.user_id,
    actorName: context.profile.display_name || context.profile.email || undefined,
    type: "portal_token_rotate",
    description: `Rotated portal token for candidate ${candidate.name}`,
    entityType: "candidate",
    entityId: candidate.id,
    entityName: candidate.name,
    metadata: { ttlDays },
  });

  return NextResponse.json({
    candidateId: candidate.id,
    portal_token: candidate.portal_token,
    portalUrl: `/portal/${candidate.portal_token}`,
    expiresInDays: ttlDays,
  });
}
