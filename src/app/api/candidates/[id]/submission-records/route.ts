import { NextResponse } from "next/server";
import { ALL_USER_ROLES, requireCurrentUser } from "@/lib/auth";
import { SUBMISSION_UUID } from "@/lib/submissionRecords";
import { listCandidateSubmissionRecords } from "@/server/services/submissionRecordService";

export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser(ALL_USER_ROLES);
  if (response) return response;
  if (!SUBMISSION_UUID.test(params.id)) return NextResponse.json({ error: "Candidate not found." }, { status: 404 });
  const search = new URL(request.url).searchParams;
  const page = Number(search.get("page") || 1), pageSize = Number(search.get("pageSize") || 25), q = search.get("q")?.trim() || "";
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 || q.length > 200) return NextResponse.json({ error: "Invalid record filters." }, { status: 400 });
  try {
    const result = await listCandidateSubmissionRecords(params.id, q, page, pageSize);
    return result ? NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } }) : NextResponse.json({ error: "Candidate not found." }, { status: 404 });
  } catch { return NextResponse.json({ error: "Could not load submission records." }, { status: 500 }); }
}
