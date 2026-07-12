// src/app/api/cron/backup/route.ts
// GET -> daily snapshot of candidates/jobs/applications/resumes to Supabase Storage
// (see vercel.json for the schedule). Gated by CRON_SECRET, same pattern as
// /api/cron/import-sources — src/middleware.ts's /api/cron bypass covers this too.

import { NextRequest, NextResponse } from "next/server";
import { buildBackupSnapshot, storeBackupSnapshot } from "@/lib/backup";
import { isNeon } from "@/server/db";
import { execute } from "@/server/db/neon";
import { supabase } from "@/lib/supabase";
import { recordJobAttempt, recordJobSuccess, recordJobFailure } from "@/server/services/scheduledJobService";

export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function logBackupAttempt(action: "backup.created" | "backup.failed", metadata: Record<string, unknown>) {
  if (isNeon()) {
    await execute(
      `INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, metadata) VALUES ($1, $2, $3, $4, $5)`,
      ["00000000-0000-0000-0000-000000000000", "system@talentos", action, "backup", metadata]
    );
  } else {
    await supabase.from("audit_logs").insert({
      actor_user_id: "00000000-0000-0000-0000-000000000000",
      actor_email: "system@talentos",
      action,
      entity_type: "backup",
      metadata,
    });
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedMs = Date.now();
  const startedAt = new Date().toISOString();
  await recordJobAttempt("backup");

  try {
    const snapshot = await buildBackupSnapshot();
    const path = await storeBackupSnapshot(snapshot);
    await logBackupAttempt("backup.created", {
      storedAt: new Date().toISOString(),
      startedAt,
      path,
      counts: snapshot.counts,
    });
    const durationMs = Date.now() - startedMs;
    const summary = JSON.stringify({ path, counts: snapshot.counts, startedAt });
    await recordJobSuccess("backup", durationMs, summary);
    return NextResponse.json({ path, counts: snapshot.counts });
  } catch (err: any) {
    const durationMs = Date.now() - startedMs;
    const errMsg = err.message ?? "backup failed";
    await logBackupAttempt("backup.failed", {
      startedAt,
      error: errMsg,
    });
    await recordJobFailure("backup", errMsg, durationMs);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
