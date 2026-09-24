import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { execute } from "@/server/db/neon";

export async function PATCH(req: Request, { params }: { params: { id: string; noteId: string } }) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  try {
    const body = await req.json().catch(() => ({}));
    const setClauses: string[] = [];
    const values: unknown[] = [];
    if ("pinned" in body) {
      values.push(Boolean(body.pinned));
      setClauses.push(`pinned = $${values.length}`);
    }
    if ("content" in body && typeof body.content === "string") {
      values.push(body.content.trim());
      setClauses.push(`content = $${values.length}`);
    }
    if (setClauses.length === 0) {
      return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
    }
    values.push(params.noteId);

    const result = await execute(
      `UPDATE student_audit_sticky_notes SET ${setClauses.join(", ")} WHERE id = $${values.length}`,
      values
    );
    if (result.rowCount === 0) return NextResponse.json({ error: "Note not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("PATCH student-audit sticky note error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string; noteId: string } }) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  try {
    await execute(`DELETE FROM student_audit_sticky_notes WHERE id = $1`, [params.noteId]);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("DELETE student-audit sticky note error:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
