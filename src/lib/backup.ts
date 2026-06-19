// src/lib/backup.ts
// Snapshot the core tables to JSON. Built after this app lived through an hour-long
// Supabase outage and a fully wiped `jobs` table mid-session — recovery only worked
// because a source import file happened to still be on disk. This is the safety net
// for next time that isn't down to luck.

import { supabase } from "@/lib/supabase";

const BACKUP_TABLES = ["candidates", "jobs", "applications", "resumes"] as const;
const RESTORE_TABLES = ["candidates", "jobs", "resumes", "applications"] as const;

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

export function parseBackupSnapshot(input: unknown): BackupSnapshot {
  if (!input || typeof input !== "object") throw new Error("Invalid backup snapshot.");
  const snapshot = input as Partial<BackupSnapshot>;
  if (typeof snapshot.takenAt !== "string" || !snapshot.tables || typeof snapshot.tables !== "object") {
    throw new Error("Invalid backup snapshot.");
  }

  for (const table of BACKUP_TABLES) {
    if (!Array.isArray(snapshot.tables[table])) {
      throw new Error(`Backup snapshot is missing table: ${table}`);
    }
  }

  return {
    takenAt: snapshot.takenAt,
    tables: snapshot.tables as Record<string, unknown[]>,
    counts: snapshot.counts ?? {},
  };
}

export async function loadStoredBackupSnapshot(path: string): Promise<BackupSnapshot> {
  const cleanPath = path.startsWith("backups/") ? path : `backups/${path}`;
  const { data, error } = await supabase.storage.from("resumes").download(cleanPath);
  if (error) throw new Error(`Failed to download backup: ${error.message}`);
  const text = await data.text();
  return parseBackupSnapshot(JSON.parse(text));
}

export async function restoreBackupSnapshot(snapshot: BackupSnapshot) {
  const restored: Record<string, number> = {};

  for (const table of RESTORE_TABLES) {
    const rows = snapshot.tables[table] ?? [];
    if (!rows.length) {
      restored[table] = 0;
      continue;
    }

    const { error } = await supabase.from(table).upsert(rows);
    if (error) throw new Error(`Failed to restore ${table}: ${error.message}`);
    restored[table] = rows.length;
  }

  return restored;
}
