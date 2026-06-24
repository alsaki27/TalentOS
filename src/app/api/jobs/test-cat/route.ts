import { NextResponse } from "next/server";
import { processPendingCategorization } from "@/lib/ai/jobCategorization";

export async function GET() {
  try {
    const result = await processPendingCategorization({ limit: 1, triggeredBy: "manual" });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message, stack: err.stack }, { status: 500 });
  }
}
