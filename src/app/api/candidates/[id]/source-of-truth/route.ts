import { NextResponse } from "next/server";
import { getSourceOfTruth, parseSourceOfTruth } from "@/server/services/sourceOfTruthService";
import { callWithUsageTracking } from "@/lib/ai/routing";
import { requireCurrentUser } from "@/lib/auth";

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const ctx = await requireCurrentUser();
    if (ctx instanceof NextResponse) return ctx;

    const sot = await getSourceOfTruth(params.id);
    return NextResponse.json(sot);
  } catch (err: any) {
    console.error("GET source-of-truth error:", err);
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

    const { result: sot } = await callWithUsageTracking(
      "candidate_source_of_truth",
      { userId: ctx.context!.profile.user_id },
      provider => parseSourceOfTruth(params.id, undefined, provider)
    );
    
    return NextResponse.json(sot);
  } catch (err: any) {
    console.error("POST source-of-truth error:", err);
    return new NextResponse(err.message || "Internal server error", { status: 500 });
  }
}
