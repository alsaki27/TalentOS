import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser, MASTER_DATA_MANAGER_ROLES } from "@/lib/auth";
import { bulkApproveByTier } from "@/server/services/candidateJobReviewQueueService";
import {parseCandidateReviewFilters} from "@/lib/candidateReviewFilters";

export const dynamic = "force-dynamic";
const VALID_TIERS = ["strong", "adjacent", "stretch"];

export async function POST(request: NextRequest) {
  const auth = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (auth.response) return auth.response;
  try {
    const body = await request.json().catch(() => ({}));
    const tiers = Array.isArray(body?.tiers) ? body.tiers.filter((t: unknown) => typeof t === "string" && VALID_TIERS.includes(t)) : [];
    if (!tiers.length) return NextResponse.json({ error: "At least one valid tier (strong, adjacent, stretch) is required." }, { status: 400 });
    if (body.filters !== undefined && typeof body.filters !== "string") return NextResponse.json({error:"Invalid filter scope."},{status:400});
    const filters = parseCandidateReviewFilters(new URLSearchParams(typeof body.filters === "string" ? body.filters : ""));
    if (filters.status !== "pending") return NextResponse.json({error:"Only pending review results can be bulk approved."},{status:400});
    const result = await bulkApproveByTier(tiers, auth.context.profile.user_id, filters);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[candidate-job-review] Bulk approve failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not bulk-approve." }, { status: 400 });
  }
}
