// src/lib/integrations/jobCrawler.ts
// Receiving side of an external job-crawler bot push (CRAWLER_API_KEY-gated), mirroring
// the team's skarion-api `/jobs` + `/jobs/crawler-status` endpoints. The bot itself lives
// outside this app (and outside skarion-api too — it pushes in from somewhere else), so
// this is the ingestion + heartbeat-tracking side only, mapped onto this app's existing
// `jobs` table instead of a separate one.

import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { query, queryOne, execute } from "@/server/db/neon";
import { findJobByExternalIdAndSource, updateJob, createJob } from "@/server/repositories/jobsRepository";

export interface CrawlerJobPayload {
  title: string;
  company?: string;
  link?: string;
  externalId: string;
  postedAt?: string;
  platform?: string;
  location?: string;
  employmentType?: string;
  workplaceType?: string;
  sourceUrl?: string;
  metadata?: Record<string, unknown>;
}

export function isCrawlerAuthorized(authHeader: string | null): boolean {
  const key = process.env.CRAWLER_API_KEY;
  if (!key) return false;
  return authHeader === `Bearer ${key}`;
}

/** Upserts a crawler-sourced job by externalId, matching the existing "skip if already seen" dedup convention used by the other importers (matched by posting URL there, by externalId here since the crawler always supplies a stable id). */
export async function upsertCrawlerJob(payload: CrawlerJobPayload) {
  if (!payload.title || !payload.externalId) {
    throw new Error("title and externalId are required");
  }

  const existing = await findJobByExternalIdAndSource(payload.externalId, "crawler");

  const row = {
    title: payload.title,
    company: payload.company ?? null,
    location: payload.location ?? null,
    source: "crawler",
    source_url: payload.sourceUrl ?? payload.link ?? null,
    apply_url: payload.link ?? null,
    employment_type: payload.employmentType ?? null,
    external_job_id: payload.externalId,
    posted_at: payload.postedAt ?? null,
    raw_source_payload: { platform: payload.platform, workplaceType: payload.workplaceType, metadata: payload.metadata },
    last_seen_at: new Date().toISOString(),
  };

  if (existing) {
    const data = await updateJob(existing.id, row);
    return { job: data, created: false };
  }

  const data = await createJob(row);
  return { job: data, created: true };
}

export async function recordHeartbeat(crawlerName: string, isActive: boolean, message?: string) {
  if (isNeon()) {
    const data = await queryOne<any>(
      `INSERT INTO job_crawler_status (crawler_name, is_active, message, last_heartbeat_at, updated_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (crawler_name) DO UPDATE SET is_active = EXCLUDED.is_active, message = EXCLUDED.message, last_heartbeat_at = EXCLUDED.last_heartbeat_at, updated_at = EXCLUDED.updated_at
       RETURNING *`,
      [crawlerName, isActive, message ?? null, new Date().toISOString(), new Date().toISOString()]
    );
    return data;
  }
  const { data, error } = await supabase
    .from("job_crawler_status")
    .upsert(
      { crawler_name: crawlerName, is_active: isActive, message: message ?? null, last_heartbeat_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: "crawler_name" },
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

const OFFLINE_GRACE_MINUTES = 10;

export function computeIsOnline(lastHeartbeatAt: string | null, offlineThresholdMinutes = OFFLINE_GRACE_MINUTES): boolean {
  if (!lastHeartbeatAt) return false;
  const ageMs = Date.now() - new Date(lastHeartbeatAt).getTime();
  return ageMs <= offlineThresholdMinutes * 60_000;
}

export async function getCrawlerStatuses() {
  if (isNeon()) {
    const data = await query<any>("SELECT * FROM job_crawler_status ORDER BY crawler_name ASC");
    return (data ?? []).map((row: any) => ({
      ...row,
      isOnline: row.is_active && computeIsOnline(row.last_heartbeat_at, row.offline_threshold_minutes),
    }));
  }
  const { data, error } = await supabase.from("job_crawler_status").select("*").order("crawler_name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({
    ...row,
    isOnline: row.is_active && computeIsOnline(row.last_heartbeat_at, row.offline_threshold_minutes),
  }));
}
