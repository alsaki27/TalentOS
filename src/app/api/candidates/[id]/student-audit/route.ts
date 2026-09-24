import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query, queryOne } from "@/server/db/neon";

interface LinkRow {
  candidate_id: string;
  audit_student_id: string;
  linked_at: string;
}

interface AuditStudentRow {
  id: string;
  name: string;
  domain: string | null;
  target_role: string | null;
  joining_date: string | null;
  progress: number;
  mock_interviews: number;
  rating: string;
  placement_company: string | null;
  placement_role: string | null;
  placement_date: string | null;
  placement_readiness: number | null;
  synced_at: string;
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  try {
    const link = await queryOne<LinkRow>(
      `SELECT candidate_id, audit_student_id, linked_at FROM student_audit_links WHERE candidate_id = $1`,
      [params.id]
    );
    if (!link) {
      return NextResponse.json({ linked: false, student: null, stickyNotes: [] });
    }

    const student = await queryOne<AuditStudentRow>(
      `SELECT id, name, domain, target_role, joining_date, progress, mock_interviews, rating,
              placement_company, placement_role, placement_date, placement_readiness, synced_at
       FROM student_audit_students WHERE id = $1`,
      [link.audit_student_id]
    );
    if (!student) {
      // The link points at a student record that no longer exists locally
      // (e.g. removed from candidate_db on the last import).
      return NextResponse.json({ linked: false, student: null, stickyNotes: [], staleLink: true });
    }

    const stickyNotes = await query(
      `SELECT id, date, content, category, author, accent, pinned
       FROM student_audit_sticky_notes WHERE student_id = $1 ORDER BY date DESC, id DESC`,
      [link.audit_student_id]
    );

    return NextResponse.json({ linked: true, student, stickyNotes, syncedAt: student.synced_at });
  } catch (err: any) {
    console.error("GET candidate student-audit error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
