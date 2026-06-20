// src/app/api/import/ats/route.ts
// POST -> pull live jobs from a company's public Greenhouse/Lever/Ashby job board, or a
// USAJobs keyword search (no scraping) and bulk insert new ones into the jobs table.

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { isNeon } from "@/server/db";
import { query } from "@/server/db/neon";
import { fetchAtsJobs } from "@/lib/atsFetchers";
import { filterNewJobs } from "@/lib/jobDedup";
import { syncCompanyDirectoryFromJobs } from "@/lib/companyDirectory";

const PROVIDERS = ["greenhouse", "lever", "ashby", "usajobs"] as const;

export async function POST(req: NextRequest) {
  const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

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

  let data: any[];
  let error: any;

  if (isNeon()) {
    if (newRows.length === 0) {
      data = [];
      error = null;
    } else {
      const cols = Object.keys(newRows[0]);
      const values: any[] = [];
      const placeholders: string[] = [];
      let paramIdx = 1;
      for (const row of newRows) {
        const rowPlaceholders: string[] = [];
        for (const col of cols) {
          rowPlaceholders.push(`$${paramIdx++}`);
          values.push((row as any)[col]);
        }
        placeholders.push(`(${rowPlaceholders.join(", ")})`);
      }
      const sql = `INSERT INTO jobs (${cols.join(", ")}) VALUES ${placeholders.join(", ")} RETURNING *`;
      data = await query(sql, values);
      error = null;
    }
  } else {
    const res = await supabase.from("jobs").insert(newRows).select("*");
    data = res.data ?? [];
    error = res.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await syncCompanyDirectoryFromJobs(data ?? []);

  return NextResponse.json({
    imported: data.length,
    skipped: duplicates,
  });
}
