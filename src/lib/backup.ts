// src/lib/backup.ts
// Snapshot the core tables to JSON. Built after this app lived through an hour-long
// Supabase outage and a fully wiped `jobs` table mid-session — recovery only worked
// because a source import file happened to still be on disk. This is the safety net
// for next time that isn't down to luck.

import { supabase } from "@/lib/supabase";

const BACKUP_TABLES = ["candidates", "jobs", "applications", "resumes"] as const;

export interface BackupSnapshot {
  takenAt: string;
  tables: Record<string, unknown[]>;
  counts: Record<string, number>;
}

export async function buildBackupSnapshot(): Promise<BackupSnapshot> {
  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};

  for (const table of BACKUP_TABLES) {
    const { data, error } = await supabase.from(table).select("*");
    if (error) throw new Error(`Failed to read ${table}: ${error.message}`);
    tables[table] = data ?? [];
    counts[table] = data?.length ?? 0;
  }

  return { takenAt: new Date().toISOString(), tables, counts };
}

export async function storeBackupSnapshot(snapshot: BackupSnapshot): Promise<string> {
  const path = `backups/${snapshot.takenAt.replace(/[:.]/g, "-")}.json`;
  const { error } = await supabase.storage
    .from("resumes")
    .upload(path, JSON.stringify(snapshot), { contentType: "application/json", upsert: true });

  if (error) throw new Error(`Failed to store backup: ${error.message}`);
  return path;
}
