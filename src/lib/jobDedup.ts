// src/lib/jobDedup.ts
// Prevents duplicate job rows when re-importing from any source (CSV, LinkedIn, ATS).
// Matches on source_url; rows without a source_url can't be deduped and are always treated as new.

import { supabase } from "@/lib/supabase";

export async function filterNewJobs<T extends { source_url?: string | null }>(
  rows: T[]
): Promise<{ newRows: T[]; duplicates: number }> {
  const urls = rows.map((r) => r.source_url).filter((u): u is string => !!u);

  if (urls.length === 0) {
    return { newRows: rows, duplicates: 0 };
  }

  const { data: existing } = await supabase
    .from("jobs")
    .select("source_url")
    .in("source_url", urls);

  const existingUrls = new Set((existing ?? []).map((j) => j.source_url as string));

  if (existingUrls.size > 0) {
    await supabase
      .from("jobs")
      .update({ last_seen_at: new Date().toISOString() })
      .in("source_url", Array.from(existingUrls));
  }

  const newRows = rows.filter((r) => !r.source_url || !existingUrls.has(r.source_url));
  return { newRows, duplicates: rows.length - newRows.length };
}
