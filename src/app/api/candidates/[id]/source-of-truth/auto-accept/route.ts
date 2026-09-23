import { NextResponse } from "next/server";
import { autoAcceptHighConfidenceSkills } from "@/server/services/sourceOfTruthService";
import { requireCurrentUser } from "@/lib/auth";

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const ctx = await requireCurrentUser();
    if (ctx instanceof NextResponse) return ctx;

    const result = await autoAcceptHighConfidenceSkills(params.id);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error("POST auto-accept error:", err);
    return new NextResponse(err.message || "Internal server error", { status: 500 });
  }
}
