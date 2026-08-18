import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import {
  findAuditStudentByCandidateId,
  listStickyNotes,
  listMockSessions,
  listCalendarEvents,
  patchAuditStudent,
} from "@/server/db/auditBridge";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  try {
    const student = await findAuditStudentByCandidateId(params.id);
    if (!student) {
      return NextResponse.json({ linked: false, student: null, stickyNotes: [], mockSessions: [], calendarEvents: [] });
    }

    const [stickyNotes, mockSessions, calendarEvents] = await Promise.all([
      listStickyNotes(student.id),
      listMockSessions(student.id),
      listCalendarEvents(student.id),
    ]);

    return NextResponse.json({ linked: true, student, stickyNotes, mockSessions, calendarEvents });
  } catch (err: any) {
    console.error("GET candidate audit summary error:", err);
    return new NextResponse(err.message || "Internal server error", { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  try {
    const student = await findAuditStudentByCandidateId(params.id);
    if (!student) {
      return NextResponse.json({ error: "No audit record linked to this candidate" }, { status: 404 });
    }
    const body = await req.json();
    const updated = await patchAuditStudent(student.id, body);
    return NextResponse.json(updated);
  } catch (err: any) {
    console.error("PATCH candidate audit error:", err);
    return new NextResponse(err.message || "Internal server error", { status: 500 });
  }
}
