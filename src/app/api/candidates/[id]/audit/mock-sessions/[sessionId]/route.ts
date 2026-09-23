import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { getMockSession } from "@/server/db/auditBridge";

export async function GET(req: Request, { params }: { params: { id: string; sessionId: string } }) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  try {
    const session = await getMockSession(params.sessionId);
    return NextResponse.json(session);
  } catch (err: any) {
    console.error("GET candidate audit mock session error:", err);
    return new NextResponse(err.message || "Internal server error", { status: 500 });
  }
}
