// src/app/api/ops/export/route.ts
// GET -> admin-triggered on-demand backup download (same snapshot the daily cron
// takes, but immediate and returned directly as a file instead of stored).

import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { buildBackupSnapshot } from "@/lib/backup";

export const dynamic = "force-dynamic";

export async function GET() {
  const { response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const snapshot = await buildBackupSnapshot();
  const filename = `skarion-backup-${snapshot.takenAt.replace(/[:.]/g, "-")}.json`;

  return new NextResponse(JSON.stringify(snapshot), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
