// src/lib/jobSources/registry.ts
// Single lookup point from a job_sources.id (DB row) to its adapter
// implementation. This replaces the pattern jobAgentService.ts uses today
// (a hardcoded ACTOR_IDS map + per-source `if` branches in
// normalizeActorItem) — new sources register here instead of adding a new
// branch to an existing function.
//
// The 3 existing Apify actors (indeed/google/linkedin) are NOT migrated
// into this registry — they keep working exactly as-is through
// jobAgentService.ts. This registry is additive, for the 7 new sources only.

import type { JobSourceAdapter } from "./types";
import { theirStackAdapter } from "./adapters/theirstack";
import { linkUpAdapter } from "./adapters/linkup";
import { coresignalAdapter } from "./adapters/coresignal";
import { fantasticJobsAdapter } from "./adapters/fantasticJobs";
import { jobDataApiAdapter } from "./adapters/jobdataapi";
import { techmapAdapter } from "./adapters/techmap";
import { brightDataAdapter } from "./adapters/brightdata";

const REGISTRY: Record<string, JobSourceAdapter> = {
  theirstack: theirStackAdapter,
  linkup: linkUpAdapter,
  coresignal: coresignalAdapter,
  fantasticjobs: fantasticJobsAdapter,
  jobdataapi: jobDataApiAdapter,
  techmap: techmapAdapter,
  brightdata: brightDataAdapter,
};

export function getJobSourceAdapter(sourceId: string): JobSourceAdapter | null {
  return REGISTRY[sourceId] ?? null;
}

export function listRegisteredSourceIds(): string[] {
  return Object.keys(REGISTRY);
}
