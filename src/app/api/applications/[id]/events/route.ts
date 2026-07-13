// src/app/api/applications/[id]/events/route.ts
// GET -> status-change timeline for one application

import { NextRequest, NextResponse } from "next/server";
import { query } from "@/server/db/neon";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const data = await query<Record<string, any>>(
    'SELECT * FROM application_events WHERE application_id = $1 ORDER BY created_at ASC LIMIT 100',
    [params.id]
  );
  return NextResponse.json(data);
}
