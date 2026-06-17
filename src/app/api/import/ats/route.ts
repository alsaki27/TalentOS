// src/app/api/import/ats/route.ts
// POST -> pull live jobs from a company's public Greenhouse/Lever/Ashby job board, or a
// USAJobs keyword search (no scraping) and bulk insert new ones into the jobs table.

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { fetchAtsJobs } from "@/lib/atsFetchers";
import { filterNewJobs } from "@/lib/jobDedup";

const PROVIDERS = ["greenhouse", "lever", "ashby", "usajobs"] as const;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const provider = body.provider;
  const token = body.token?.trim();

  if (!PROVIDERS.includes(provider)) {
    return NextResponse.json({ error: "provider must be one of: greenhouse, lever, ashby, usajobs" }, { status: 400 });
  }
  if (!token) {
    return NextResponse.json({ error: provider === "usajobs" ? "search keyword is required" : "token (company board slug) is required" }, { status: 400 });
  }

  let rows;
  try {
    rows = await fetchAtsJobs(provider, token);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "failed to fetch jobs" }, { status: 502 });
  }

  if (rows.length === 0) {
    return NextResponse.json({ imported: 0, skipped: 0 });
  }

  const { newRows, duplicates } = await filterNewJobs(rows);

  if (newRows.length === 0) {
    return NextResponse.json({ imported: 0, skipped: duplicates });
  }

  const { data, error } = await supabase.from("jobs").insert(newRows).select("id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    imported: data.length,
    skipped: duplicates,
  });
}
