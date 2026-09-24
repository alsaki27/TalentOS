import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query, queryOne } from "@/server/db/neon";
import { ensureLinked } from "@/server/services/studentAuditLink";

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

const STUDENT_COLUMNS = `
  id, name, domain, target_role, joining_date, progress, mock_interviews, rating,
  placement_company, placement_role, placement_date, placement_readiness, synced_at
`;

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  try {
    const auditStudentId = await ensureLinked(params.id);

    const student = await queryOne<AuditStudentRow>(
      `SELECT ${STUDENT_COLUMNS} FROM student_audit_students WHERE id = $1`,
      [auditStudentId]
    );
    if (!student) {
      return NextResponse.json({ error: "Failed to provision training-audit record" }, { status: 500 });
    }

    const [stickyNotes, mockSessions] = await Promise.all([
      query(
        `SELECT id, date, content, category, author, accent, pinned
         FROM student_audit_sticky_notes WHERE student_id = $1 ORDER BY date DESC, id DESC`,
        [auditStudentId]
      ),
      query<MockSessionRow>(
        `SELECT id, session_date, target_role, overall_score, overall_score_max, raw_analysis_text
         FROM student_audit_mock_sessions WHERE student_id = $1 ORDER BY session_date DESC, id DESC`,
        [auditStudentId]
      ),
    ]);

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
    const auditStudentId = await ensureLinked(params.id);

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
    values.push(auditStudentId);

    const updated = await queryOne<AuditStudentRow>(
      `UPDATE student_audit_students SET ${setClauses.join(", ")} WHERE id = $${values.length} RETURNING ${STUDENT_COLUMNS}`,
      values
    );
    return NextResponse.json({ student: updated });
  } catch (err: any) {
    console.error("PATCH candidate student-audit error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
