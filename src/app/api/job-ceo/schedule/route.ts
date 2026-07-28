import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { query, execute } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export interface ScheduleRow {
  id: string;
  is_enabled: boolean;
  cron_expression: string;
  role_group: string;
  days_back: number;
  dry_run: boolean;
  notes: string | null;
  updated_at: string;
}

export async function GET(req: NextRequest) {
  // Allow GitHub Actions / cron callers to read the schedule using CRON_SECRET bearer
  // without needing a session cookie (which they can never have).
  const authHeader = req.headers.get("authorization") || "";
  const cronSecret = process.env.CRON_SECRET;
  const hasCronAuth = cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!hasCronAuth) {
    // Fall back to normal session-based auth for dashboard users
    const { response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
    if (response) return response;
  }

  try {
    const rows = await query<ScheduleRow>("SELECT * FROM job_ceo_schedule ORDER BY updated_at DESC LIMIT 1");
    if (rows.length === 0) {
      // Return sensible defaults if table is empty
      return NextResponse.json({
        id: null,
        is_enabled: false,
        cron_expression: "30 9 * * *",
        role_group: "all",
        days_back: 1,
        dry_run: false,
        notes: null,
        updated_at: null,
      });
    }
    return NextResponse.json(rows[0]);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not load schedule" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  let body: Partial<ScheduleRow>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    // Upsert — always update the single schedule row
    const existing = await query<ScheduleRow>("SELECT id FROM job_ceo_schedule LIMIT 1");

    if (existing.length > 0) {
      const sets: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      if (body.is_enabled !== undefined) { sets.push(`is_enabled = $${idx}`); values.push(body.is_enabled); idx++; }
      if (body.cron_expression !== undefined) { sets.push(`cron_expression = $${idx}`); values.push(body.cron_expression); idx++; }
      if (body.role_group !== undefined) { sets.push(`role_group = $${idx}`); values.push(body.role_group); idx++; }
      if (body.days_back !== undefined) { sets.push(`days_back = $${idx}`); values.push(body.days_back); idx++; }
      if (body.dry_run !== undefined) { sets.push(`dry_run = $${idx}`); values.push(body.dry_run); idx++; }
      if (body.notes !== undefined) { sets.push(`notes = $${idx}`); values.push(body.notes); idx++; }

      sets.push("updated_at = NOW()");
      sets.push(`updated_by = $${idx}`);
      values.push((context as any)?.profile?.user_id ?? null);
      idx++;

      values.push(existing[0].id);
      const rows = await query<ScheduleRow>(
        `UPDATE job_ceo_schedule SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
        values
      );
      return NextResponse.json(rows[0]);
    } else {
      const rows = await query<ScheduleRow>(
        `INSERT INTO job_ceo_schedule (is_enabled, cron_expression, role_group, days_back, dry_run, notes)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          body.is_enabled ?? true,
          body.cron_expression ?? "30 9 * * *",
          body.role_group ?? "all",
          body.days_back ?? 1,
          body.dry_run ?? false,
          body.notes ?? null,
        ]
      );
      return NextResponse.json(rows[0], { status: 201 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "Could not save schedule" }, { status: 500 });
  }
}
