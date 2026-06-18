// src/app/api/cron/backup/route.ts
// GET -> daily snapshot of candidates/jobs/applications/resumes to Supabase Storage
// (see vercel.json for the schedule). Gated by CRON_SECRET, same pattern as
// /api/cron/import-sources — src/middleware.ts's /api/cron bypass covers this too.

import { NextRequest, NextResponse } from "next/server";
import { buildBackupSnapshot, storeBackupSnapshot } from "@/lib/backup";

export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const snapshot = await buildBackupSnapshot();
    const path = await storeBackupSnapshot(snapshot);
    return NextResponse.json({ path, counts: snapshot.counts });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "backup failed" }, { status: 500 });
  }
}
