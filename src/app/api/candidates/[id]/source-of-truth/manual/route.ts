import { NextResponse } from "next/server";
import { addManualSkill } from "@/server/services/sourceOfTruthService";
import { requireCurrentUser } from "@/lib/auth";

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const ctx = await requireCurrentUser();
    if (ctx instanceof NextResponse) return ctx;

    const { skill, category } = await req.json();
    if (!skill || !category) {
      return new NextResponse("Missing skill or category", { status: 400 });
    }

    await addManualSkill(params.id, skill, category);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("POST manual skill error:", err);
    return new NextResponse(err.message || "Internal server error", { status: 500 });
  }
}
