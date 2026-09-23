import { NextRequest, NextResponse } from "next/server";
import { getRunStats, listRuns } from "@/server/repositories/jobCeoRunRepository";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  try {
    const [runs, stats] = await Promise.all([listRuns(50), getRunStats()]);
    return NextResponse.json({ runs, stats });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message ?? String(err) }, { status: 500 });
  }
}
