import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { execute, queryOne } from "@/server/db/neon";
import { findCandidateById } from "@/server/repositories/candidatesRepository";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  try {
    const body = await req.json().catch(() => ({}));
    const auditStudentId = typeof body?.auditStudentId === "string" ? body.auditStudentId.trim() : "";
    if (!auditStudentId) {
      return NextResponse.json({ error: "auditStudentId is required" }, { status: 400 });
    }

    const candidate = await findCandidateById(params.id);
    if (!candidate) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }

    const student = await queryOne(`SELECT id FROM student_audit_students WHERE id = $1`, [auditStudentId]);
    if (!student) {
      return NextResponse.json({ error: "No student-audit record found with that id" }, { status: 404 });
    }

    await execute(
      `INSERT INTO student_audit_links (candidate_id, audit_student_id, linked_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (candidate_id) DO UPDATE SET
         audit_student_id = EXCLUDED.audit_student_id,
         linked_at = now(),
         linked_by = EXCLUDED.linked_by`,
      [params.id, auditStudentId, context?.profile.user_id ?? null]
    );

    return NextResponse.json({ linked: true });
  } catch (err: any) {
    console.error("POST candidate student-audit link error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  try {
    await execute(`DELETE FROM student_audit_links WHERE candidate_id = $1`, [params.id]);
    return NextResponse.json({ linked: false });
  } catch (err: any) {
    console.error("DELETE candidate student-audit link error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
