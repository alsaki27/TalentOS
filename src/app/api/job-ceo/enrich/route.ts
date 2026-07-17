import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { processEnrichmentBatch } from "@/server/services/jobEnrichmentService";

export const dynamic = "force-dynamic";

// POST — manual trigger (admin/manager), processes one batch synchronously
// and returns the result directly (small batch, no need for the
// self-fetch/backgroundDispatch dance the ingest pipeline needs).
export async function POST(_req: NextRequest) {
  const { response } = await requireCurrentUser(["admin", "manager"]);
  if (response) return response;

  try {
    const result = await processEnrichmentBatch();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message ?? String(err) }, { status: 500 });
  }
}

// GET — cron-triggered (scheduled-jobs.yml), same CRON_SECRET convention
// as every other cron endpoint in this codebase (dispatch, digest, etc.).
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processEnrichmentBatch();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message ?? String(err) }, { status: 500 });
  }
}
