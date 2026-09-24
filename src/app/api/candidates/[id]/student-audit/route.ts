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

interface MockSessionRow {
  id: string;
  session_date: string;
  target_role: string | null;
  overall_score: number | null;
  overall_score_max: number | null;
  raw_analysis_text: string | null;
}

const EDITABLE_FIELDS = [
  "domain",
  "target_role",
  "progress",
  "rating",
  "placement_company",
  "placement_role",
  "placement_date",
] as const;

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  try {
    const link = await queryOne<LinkRow>(
      `SELECT candidate_id, audit_student_id, linked_at FROM student_audit_links WHERE candidate_id = $1`,
      [params.id]
    );
    if (!link) {
      return NextResponse.json({ linked: false, student: null, stickyNotes: [], mockSessions: [] });
    }

    const student = await queryOne<AuditStudentRow>(
      `SELECT id, name, domain, target_role, joining_date, progress, mock_interviews, rating,
              placement_company, placement_role, placement_date, placement_readiness, synced_at
       FROM student_audit_students WHERE id = $1`,
      [link.audit_student_id]
    );
    if (!student) {
      // The link points at a student record that no longer exists locally.
      return NextResponse.json({ linked: false, student: null, stickyNotes: [], mockSessions: [], staleLink: true });
    }

    const [stickyNotes, mockSessions] = await Promise.all([
      query(
        `SELECT id, date, content, category, author, accent, pinned
         FROM student_audit_sticky_notes WHERE student_id = $1 ORDER BY date DESC, id DESC`,
        [link.audit_student_id]
      ),
      query<MockSessionRow>(
        `SELECT id, session_date, target_role, overall_score, overall_score_max, raw_analysis_text
         FROM student_audit_mock_sessions WHERE student_id = $1 ORDER BY session_date DESC, id DESC`,
        [link.audit_student_id]
      ),
    ]);

    // Same rule as the original student-audit app: once real sessions exist,
    // their count is the source of truth over the imported/manual integer.
    const effectiveMockInterviews = mockSessions.length > 0 ? mockSessions.length : student.mock_interviews;

    return NextResponse.json({
      linked: true,
      student: { ...student, mock_interviews: effectiveMockInterviews },
      stickyNotes,
      mockSessions,
      syncedAt: student.synced_at,
    });
  } catch (err: any) {
    console.error("GET candidate student-audit error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  try {
    const link = await queryOne<LinkRow>(
      `SELECT audit_student_id FROM student_audit_links WHERE candidate_id = $1`,
      [params.id]
    );
    if (!link) {
      return NextResponse.json({ error: "No student-audit record linked to this candidate" }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const setClauses: string[] = [];
    const values: unknown[] = [];
    for (const field of EDITABLE_FIELDS) {
      if (field in body) {
        values.push(body[field]);
        setClauses.push(`${field} = $${values.length}`);
      }
    }
    if (setClauses.length === 0) {
      return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
    }
    values.push(link.audit_student_id);

    const updated = await queryOne<AuditStudentRow>(
      `UPDATE student_audit_students SET ${setClauses.join(", ")} WHERE id = $${values.length} RETURNING
         id, name, domain, target_role, joining_date, progress, mock_interviews, rating,
         placement_company, placement_role, placement_date, placement_readiness, synced_at`,
      values
    );
    return NextResponse.json({ student: updated });
  } catch (err: any) {
    console.error("PATCH candidate student-audit error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
