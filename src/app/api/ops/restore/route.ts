// src/app/api/ops/restore/route.ts
// POST -> admin-only backup restore. Accepts JSON body with { path | name | snapshot }
// or multipart form data with a JSON file. Requires an explicit confirmation phrase.

import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { loadStoredBackupSnapshot, parseBackupSnapshot, restoreBackupSnapshot } from "@/lib/backup";
import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { execute } from "@/server/db/neon";

export const dynamic = "force-dynamic";

const CONFIRMATION_PHRASE = "RESTORE TALENTOS BACKUP";

async function snapshotFromRequest(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const confirm = String(form.get("confirm") ?? "");
    if (confirm !== CONFIRMATION_PHRASE) {
      return {
        error: NextResponse.json(
          { error: `Restore requires confirm: ${CONFIRMATION_PHRASE}` },
          { status: 400 },
        ),
      };
    }

    const path = String(form.get("path") ?? form.get("name") ?? "").trim();
    const file = form.get("file");
    if (file instanceof File) {
      const text = await file.text();
      return { snapshot: parseBackupSnapshot(JSON.parse(text)), source: file.name || "uploaded-json" };
    }
    if (path) return { snapshot: await loadStoredBackupSnapshot(path), source: path };

    return { error: NextResponse.json({ error: "Provide a stored backup path or JSON file." }, { status: 400 }) };
  }

  const body = await req.json().catch(() => ({}));
  if (body.confirm !== CONFIRMATION_PHRASE) {
    return {
      error: NextResponse.json(
        { error: `Restore requires confirm: ${CONFIRMATION_PHRASE}` },
        { status: 400 },
      ),
    };
  }

  if (body.snapshot) return { snapshot: parseBackupSnapshot(body.snapshot), source: "inline-snapshot" };

  const path = String(body.path ?? body.name ?? "").trim();
  if (!path) return { error: NextResponse.json({ error: "Provide path, name, or snapshot." }, { status: 400 }) };
  return { snapshot: await loadStoredBackupSnapshot(path), source: path };
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;

  try {
    const result = await snapshotFromRequest(req);
    if (result.error) return result.error;

    const restored = await restoreBackupSnapshot(result.snapshot);

    if (isNeon()) {
      await execute(
        'INSERT INTO audit_logs (actor_user_id, actor_email, action, entity_type, metadata) VALUES ($1, $2, $3, $4, $5)',
        [
          context!.profile.user_id,
          context!.profile.email,
          'backup.restored',
          'backup',
          {
            source: result.source,
            takenAt: result.snapshot.takenAt,
            restored,
            mode: 'upsert',
          },
        ]
      );
    } else {
      await supabase.from("audit_logs").insert({
        actor_user_id: context!.profile.user_id,
        actor_email: context!.profile.email,
        action: "backup.restored",
        entity_type: "backup",
        metadata: {
          source: result.source,
          takenAt: result.snapshot.takenAt,
          restored,
          mode: "upsert",
        },
      });
    }

    return NextResponse.json({
      ok: true,
      mode: "upsert",
      source: result.source,
      takenAt: result.snapshot.takenAt,
      restored,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Restore failed." }, { status: 500 });
  }
}
