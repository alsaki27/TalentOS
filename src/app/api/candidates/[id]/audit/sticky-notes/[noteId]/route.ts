import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { patchStickyNote, deleteStickyNote } from "@/server/db/auditBridge";

export async function PATCH(req: Request, { params }: { params: { id: string; noteId: string } }) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  try {
    const body = await req.json();
    const note = await patchStickyNote(params.noteId, body);
    return NextResponse.json(note);
  } catch (err: any) {
    console.error("PATCH candidate audit sticky note error:", err);
    return new NextResponse(err.message || "Internal server error", { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string; noteId: string } }) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  try {
    await deleteStickyNote(params.noteId);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("DELETE candidate audit sticky note error:", err);
    return new NextResponse(err.message || "Internal server error", { status: 500 });
  }
}
