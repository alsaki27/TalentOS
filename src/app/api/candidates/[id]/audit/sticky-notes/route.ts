import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { findAuditStudentByCandidateId, createStickyNote } from "@/server/db/auditBridge";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  try {
    const student = await findAuditStudentByCandidateId(params.id);
    if (!student) {
      return NextResponse.json({ error: "No audit record linked to this candidate" }, { status: 404 });
    }

    const body = await req.json();
    const note = await createStickyNote({
      student_id: student.id,
      date: body.date ?? new Date().toISOString().slice(0, 10),
      content: body.content,
      category: body.category,
      accent: body.accent,
      pinned: body.pinned,
      author: context!.profile.display_name,
    });
    return NextResponse.json(note);
  } catch (err: any) {
    console.error("POST candidate audit sticky note error:", err);
    return new NextResponse(err.message || "Internal server error", { status: 500 });
  }
}
