import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { findCandidateById } from "@/server/repositories/candidatesRepository";
import { findAuditStudentByCandidateId, createAuditStudent } from "@/server/db/auditBridge";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  try {
    const existing = await findAuditStudentByCandidateId(params.id);
    if (existing) return NextResponse.json(existing);

    const candidate = await findCandidateById(params.id);
    if (!candidate) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }

    const student = await createAuditStudent({
      talentos_candidate_id: params.id,
      name: candidate.name ?? "Unnamed candidate",
      target_role: candidate.target_roles,
    });
    return NextResponse.json(student);
  } catch (err: any) {
    console.error("POST candidate audit link error:", err);
    return new NextResponse(err.message || "Internal server error", { status: 500 });
  }
}
