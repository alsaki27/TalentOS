import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { findAuditStudentByCandidateId, createCalendarEvent } from "@/server/db/auditBridge";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  try {
    const student = await findAuditStudentByCandidateId(params.id);
    if (!student) {
      return NextResponse.json({ error: "No audit record linked to this candidate" }, { status: 404 });
    }

    const body = await req.json();
    const event = await createCalendarEvent({
      student_id: student.id,
      event_date: body.event_date,
      duration_min: body.duration_min ?? null,
      title: body.title,
      description: body.description ?? null,
      event_type: body.event_type ?? "other",
      linked_session_id: body.linked_session_id ?? null,
      created_by: context!.profile.display_name,
    });
    return NextResponse.json(event);
  } catch (err: any) {
    console.error("POST candidate audit calendar event error:", err);
    return new NextResponse(err.message || "Internal server error", { status: 500 });
  }
}
