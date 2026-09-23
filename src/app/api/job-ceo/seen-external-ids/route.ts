import { NextRequest, NextResponse } from "next/server";
import { query } from "@/server/db/neon";

export const dynamic = "force-dynamic";

// Lets a source-enumerating script (Actalent, Broadstaff, any future one)
// find out which of ITS OWN external_job_ids have already been recorded,
// so it can skip re-fetching a job's detail page entirely rather than
// fetching it fresh every run only to have the ingest route discard it as
// a duplicate afterward.
//
// This does not change correctness — job-ceo/ingest's dedup (see
// computeJobDedupSignature in jobCeoStagingRepository.ts) is permanent and
// authoritative regardless of whether a caller uses this endpoint first.
// It only lets a script avoid the wasted network request and site load for
// a result it could already predict. Neither site here publishes a "what's
// new since date X" delta feed (unlike OpenJobData's dataset), so without
// this a daily run has no way to know which of the postings it's about to
// re-fetch it has already seen, until after it has already spent the
// request finding out.
//
// Reads job_ceo_seen_signatures by prefix match against the
// "id:{source}:{external_job_id}" signature shape computeJobDedupSignature
// produces for any job with an external_job_id — this is a LIKE 'prefix%'
// query, which Postgres can satisfy from the signature primary key's
// b-tree index (no leading wildcard). Bearer-authenticated with the same
// JOB_CEO_INGEST_SECRET as the other script-facing Job CEO routes.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || "";
  const secret = process.env.JOB_CEO_INGEST_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const source = (url.searchParams.get("source") || "").trim().toLowerCase();
  if (!source) {
    return NextResponse.json({ error: "source query param is required" }, { status: 400 });
  }
  // The signature format is fixed (see computeJobDedupSignature) — a source
  // name containing "%" or "_" would be interpreted as a LIKE wildcard.
  // Sources are internal, hardcoded-per-script strings ("actalent",
  // "broadstaff", "openjobdata"), never end-user input, but this closes
  // the door on that class of query anyway rather than relying on that.
  if (!/^[a-z0-9_-]+$/.test(source)) {
    return NextResponse.json({ error: "source must contain only letters, digits, - and _" }, { status: 400 });
  }

  const prefix = `id:${source}:`;
  try {
    const rows = await query<{ signature: string }>(
      "SELECT signature FROM job_ceo_seen_signatures WHERE signature LIKE $1",
      [`${prefix}%`]
    );
    const externalIds = rows.map((r) => r.signature.slice(prefix.length));
    return NextResponse.json({ source, external_job_ids: externalIds, count: externalIds.length });
  } catch (err) {
    console.error("[Job CEO] seen-external-ids: query failed:", err);
    return NextResponse.json({ error: (err as Error).message ?? String(err) }, { status: 500 });
  }
}
