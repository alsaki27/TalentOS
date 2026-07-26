import { NextResponse } from "next/server";
import { upsertSoT } from "@/server/repositories/sourceOfTruthRepository";
import { requireCurrentUser } from "@/lib/auth";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const ctx = await requireCurrentUser();
    if (ctx instanceof NextResponse) return ctx;

    const { notes } = await req.json();

    const sot = await upsertSoT(params.id, { notes });
    return NextResponse.json(sot);
  } catch (err: any) {
    console.error("PATCH candidate SoT notes error:", err);
    return new NextResponse(err.message || "Internal server error", { status: 500 });
  }
}
