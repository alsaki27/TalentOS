import { NextResponse } from "next/server";
import { updatePendingSkillStatus, bulkUpdatePendingSkills, removeConfirmedSkill } from "@/server/services/sourceOfTruthService";
import { requireCurrentUser } from "@/lib/auth";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const ctx = await requireCurrentUser();
    if (ctx instanceof NextResponse) return ctx;

    const { skill, status } = await req.json();
    if (!skill || !status) {
      return new NextResponse("Missing skill or status", { status: 400 });
    }

    await updatePendingSkillStatus(params.id, skill, status);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("PATCH skills error:", err);
    return new NextResponse(err.message || "Internal server error", { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const ctx = await requireCurrentUser();
    if (ctx instanceof NextResponse) return ctx;

    const { updates } = await req.json();
    if (!Array.isArray(updates)) {
      return new NextResponse("Updates must be an array", { status: 400 });
    }

    await bulkUpdatePendingSkills(params.id, updates);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("POST skills error:", err);
    return new NextResponse(err.message || "Internal server error", { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const ctx = await requireCurrentUser();
    if (ctx instanceof NextResponse) return ctx;

    const { skill } = await req.json();
    if (!skill) {
      return new NextResponse("Missing skill", { status: 400 });
    }

    await removeConfirmedSkill(params.id, skill);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("DELETE skills error:", err);
    return new NextResponse(err.message || "Internal server error", { status: 500 });
  }
}
