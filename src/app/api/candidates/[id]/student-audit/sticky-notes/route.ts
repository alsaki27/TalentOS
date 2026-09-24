import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { queryOne } from "@/server/db/neon";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  try {
    const link = await queryOne<{ audit_student_id: string }>(
      `SELECT audit_student_id FROM student_audit_links WHERE candidate_id = $1`,
      [params.id]
    );
    if (!link) {
      return NextResponse.json({ error: "No student-audit record linked to this candidate" }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const content = typeof body?.content === "string" ? body.content.trim() : "";
    if (!content) {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }

    const id = `note-${Date.now()}`;
    const date = new Date().toISOString().slice(0, 10);
    const author = context?.profile.display_name || context?.profile.email || "TalentOS";

    const note = await queryOne(
      `INSERT INTO student_audit_sticky_notes (id, student_id, date, content, category, author, accent, pinned)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, date, content, category, author, accent, pinned`,
      [
        id,
        link.audit_student_id,
        date,
        content,
        typeof body?.category === "string" && body.category ? body.category : "General",
        author,
        typeof body?.accent === "string" && body.accent ? body.accent : "navy",
        Boolean(body?.pinned),
      ]
    );
    return NextResponse.json({ note }, { status: 201 });
  } catch (err: any) {
    console.error("POST student-audit sticky note error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
