import { NextResponse } from "next/server";
import { upsertSoT } from "@/server/repositories/sourceOfTruthRepository";
import { requireCurrentUser } from "@/lib/auth";

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const ctx = await requireCurrentUser();
    if (ctx instanceof NextResponse) return ctx;

    const { skills } = await req.json();
    if (!Array.isArray(skills)) {
      return new NextResponse("Invalid skills array", { status: 400 });
    }

    const sot = await upsertSoT(params.id, { confirmed_skills: skills });
    return NextResponse.json({
      confirmedSkills: sot.confirmed_skills,
      pendingSkills: sot.pending_skills,
      lastParsedAt: sot.last_parsed_at
    });
  } catch (err: any) {
    console.error("Replace skills error:", err);
    return new NextResponse(err.message || "Internal server error", { status: 500 });
  }
}
