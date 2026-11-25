import { NextResponse } from "next/server";
import { ALL_USER_ROLES, requireCurrentUser } from "@/lib/auth";
import { CANDIDATE_ACTIVITY_TYPES, readActivityCursor, readActivityDateRange, type CandidateActivityType } from "@/lib/candidateActivity";
import { getCandidateActivity } from "@/server/services/candidateActivityService";
import { canEditCustomActivity, canManageCustomActivity } from "@/lib/candidateCustomActivity";

export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser(ALL_USER_ROLES);
  if (response) return response;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.id)) return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
  const search = new URL(request.url).searchParams;
  const limit = Number(search.get("limit") || 7);
  const type = search.get("type") || undefined;
  const page = search.has("page") ? Number(search.get("page")) : undefined;
  let dateRange;
  try { dateRange = readActivityDateRange(search); }
  catch { return NextResponse.json({ error: "Provide valid activity dates (YYYY-MM-DD), with the start date on or before the end date." }, { status: 400 }); }
  let cursor;
  try { cursor = readActivityCursor(search.get("cursor")); }
  catch { return NextResponse.json({ error: "Invalid activity cursor." }, { status: 400 }); }
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || (page !== undefined && (!Number.isSafeInteger(page) || page < 1 || cursor)) || (type && !CANDIDATE_ACTIVITY_TYPES.includes(type as CandidateActivityType))) {
    return NextResponse.json({ error: "Invalid activity filters." }, { status: 400 });
  }
  try {
    const data = await getCandidateActivity(params.id, { limit, cursor, type: type as CandidateActivityType | undefined, ...(page ? { page } : {}), ...dateRange });
    return data ? NextResponse.json({
      ...data,
      canEditCustom: canEditCustomActivity(context?.profile),
      canManageCustom: canManageCustomActivity(context?.profile),
    }, { headers: { "Cache-Control": "private, no-store" } }) :
      NextResponse.json({ error: "Candidate not found." }, { status: 404 });
  } catch { return NextResponse.json({ error: "Could not load candidate activity." }, { status: 500 }); }
}
