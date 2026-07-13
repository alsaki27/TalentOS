// src/app/api/ops/digests/route.ts
// GET  -> recent stored digests (admin-only)
// POST -> generate one right now, on demand

import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { generateDailyDigest } from "@/lib/ai/digest";
import { query, queryOne } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET() {
  const { response } = await requireCurrentUser();
  if (response) return response;

  let data: any[];
  let error: any;

  data = await query(
    `SELECT id, content, provider, generated_at, last_success_at, last_error, data_summary FROM ai_digests ORDER BY generated_at DESC LIMIT 10`,
    []
  );
  error = null;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST() {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const result = await generateDailyDigest();
  if ("error" in result) {
    const errMsg = result.error;
    const data = await queryOne(
      `INSERT INTO ai_digests (content, provider, last_error) VALUES ($1, $2, $3) RETURNING id, content, provider, generated_at`,
      ["(generation failed)", "unknown", errMsg]
    );
    return NextResponse.json({ ...data, error: errMsg }, { status: 502 });
  }

  let data: any;
  let error: any;

  data = await queryOne(
    `INSERT INTO ai_digests (content, provider, last_success_at, data_summary) VALUES ($1, $2, NOW(), $3) RETURNING id, content, provider, generated_at`,
    [result.content, result.provider, JSON.stringify(result.dataSummary)]
  );
  error = data ? null : { message: "Insert failed" };

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
