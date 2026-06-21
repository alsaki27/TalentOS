// src/app/api/ops/backups/route.ts
// GET -> list recent stored backup snapshots (admin-only), newest first.

import { NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { listFiles } from "@/server/storage/storageApi";

export const dynamic = "force-dynamic";

export async function GET() {
  const { response } = await requireCurrentUser(["admin"]);
  if (response) return response;

  const files = await listFiles("backups/", 20);

  return NextResponse.json(files.map((f) => ({
    name: f.name,
    createdAt: f.created_at,
    sizeBytes: f.metadata?.size ?? null,
  })));
}

export async function POST() {
  const { response } = await requireCurrentUser(["admin"]);
  if (response) return response;
  return NextResponse.json({ error: "Use POST /api/ops/restore for backup restores." }, { status: 405 });
}