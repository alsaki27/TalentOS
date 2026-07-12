// src/app/api/ops/backup-status/route.ts
// GET -> backup health summary: last attempt, last success, last failure, backup age.
// Derives info from stored backup file metadata and audit_logs entries.

import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { isNeon } from "@/server/db";
import { query } from "@/server/db/neon";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface BackupHealth {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureError: string | null;
  backupAgeHours: number | null;
  backupAgeDays: number | null;
  totalStored: number;
}

export async function GET() {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const health: BackupHealth = {
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastFailureError: null,
    backupAgeHours: null,
    backupAgeDays: null,
    totalStored: 0,
  };

  if (isNeon()) {
    const [attemptRows, deleteLogs] = await Promise.all([
      query<any>(
        `SELECT * FROM audit_logs
         WHERE entity_type = 'backup' AND action IN ('backup.created', 'backup.failed')
         ORDER BY created_at DESC LIMIT 20`,
        []
      ),
      query<any>(
        `SELECT metadata FROM audit_logs
         WHERE entity_type = 'backup' AND action = 'backup.created'
         ORDER BY created_at DESC LIMIT 1`,
        []
      ),
    ]);

    const lastSuccess = deleteLogs?.[0];
    if (lastSuccess) {
      health.lastSuccessAt = lastSuccess.metadata?.storedAt ?? lastSuccess.metadata?.takenAt ?? null;
      health.lastAttemptAt = lastSuccess.metadata?.storedAt ?? lastSuccess.metadata?.takenAt ?? null;
    }

    for (const row of attemptRows ?? []) {
      if (row.action === "backup.created" && !health.lastSuccessAt) {
        health.lastSuccessAt = row.metadata?.storedAt ?? row.metadata?.takenAt ?? null;
      }
      if (row.action === "backup.failed" && !health.lastFailureAt) {
        health.lastFailureAt = row.created_at;
        health.lastFailureError = row.metadata?.error ?? null;
      }
    }
  } else {
    const { data: attemptRows } = await supabase
      .from("audit_logs")
      .select("*")
      .eq("entity_type", "backup")
      .in("action", ["backup.created", "backup.failed"])
      .order("created_at", { ascending: false })
      .limit(20);

    for (const row of attemptRows ?? []) {
      if (row.action === "backup.created" && !health.lastSuccessAt) {
        health.lastSuccessAt = typeof row.created_at === "string" ? row.created_at : null;
        health.lastAttemptAt = typeof row.created_at === "string" ? row.created_at : null;
      }
      if (row.action === "backup.failed" && !health.lastFailureAt) {
        health.lastFailureAt = typeof row.created_at === "string" ? row.created_at : null;
        health.lastFailureError = row.metadata?.error ?? null;
      }
    }
  }

  if (health.lastSuccessAt) {
    const ageMs = Date.now() - new Date(health.lastSuccessAt).getTime();
    health.backupAgeHours = Math.round(ageMs / 3600000);
    health.backupAgeDays = Math.round(ageMs / 86400000);
  }

  return NextResponse.json(health);
}
