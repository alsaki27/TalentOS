import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { deleteCalendarEvent } from "@/server/db/auditBridge";

export async function DELETE(req: Request, { params }: { params: { id: string; eventId: string } }) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  try {
    await deleteCalendarEvent(params.eventId);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("DELETE candidate audit calendar event error:", err);
    return new NextResponse(err.message || "Internal server error", { status: 500 });
  }
}
