// src/app/api/ops/backups/route.ts
// GET -> list recent stored backup snapshots (admin-only), newest first.

import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { loadStoredBackupSnapshot, parseBackupSnapshot, restoreBackupSnapshot } from "@/lib/backup";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  const { response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const { data, error } = await supabase.storage
    .from("resumes")
    .list("backups", { limit: 20, sortBy: { column: "name", order: "desc" } });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json((data ?? []).map((f) => ({ name: f.name, createdAt: f.created_at, sizeBytes: f.metadata?.size ?? null })));
}

export async function POST(req: Request) {
  const { context, response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const body = await req.json().catch(() => ({}));
  if (body.confirm !== "RESTORE_BACKUP") {
    return NextResponse.json({ error: "Restore requires confirm: RESTORE_BACKUP." }, { status: 400 });
  }

  const snapshot = body.snapshot
    ? parseBackupSnapshot(body.snapshot)
    : await loadStoredBackupSnapshot(String(body.name ?? body.path ?? ""));
  const restored = await restoreBackupSnapshot(snapshot);

  await supabase.from("audit_logs").insert({
    actor_user_id: context!.profile.user_id,
    actor_email: context!.profile.email,
    action: "backup.restored",
    entity_type: "backup",
    metadata: { takenAt: snapshot.takenAt, restored },
  });

  return NextResponse.json({ ok: true, takenAt: snapshot.takenAt, restored });
}
