import { NextRequest, NextResponse } from "next/server";
import { listRuns } from "@/server/repositories/jobCeoRunRepository";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || "";
  const secret = process.env.JOB_CEO_INGEST_SECRET;
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const runs = await listRuns(5);
    const latestWithTerms = runs.find((r) => r.scout_terms != null);
    if (latestWithTerms) {
      return NextResponse.json({ scoutTerms: latestWithTerms.scout_terms });
    }
    return NextResponse.json({ scoutTerms: null });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message ?? String(err) }, { status: 500 });
  }
}
