import { NextRequest, NextResponse } from "next/server";
import { listRuns } from "@/server/repositories/jobCeoRunRepository";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  try {
    const runs = await listRuns(50);
    return NextResponse.json({ runs });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message ?? String(err) }, { status: 500 });
  }
}
