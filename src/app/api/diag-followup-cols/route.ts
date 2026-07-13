import { NextResponse } from "next/server";
import { query, queryOne } from "@/server/db/neon";
import { getCurrentUserContext } from "@/lib/auth";

export const dynamic = "force-dynamic";

// TEMP diagnostic route - remove after use. Not linked from any UI.
export async function GET() {
  try {
    const cols = await query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'applications' AND column_name LIKE 'follow_up%' ORDER BY column_name`
    );

    const context = await getCurrentUserContext();
    if (!context) return NextResponse.json({ ok: true, cols, note: "no auth context" });

    const userId = context.profile.user_id;
    const userEmail = context.profile.email ?? null;
    const userDisplayName = context.profile.display_name ?? null;
    const userRole = context.profile.role;
    const today = new Date().toISOString().slice(0, 10);

    const dataSql = `
      SELECT a.id, a.status, a.follow_up_at, a.follow_up_source, a.follow_up_created_at,
        a.assigned_to, a.assigned_to_user_id, a.next_action,
        jsonb_build_object('id', c.id, 'name', c.name) as candidates,
        jsonb_build_object('id', j.id, 'title', j.title, 'company', j.company) as jobs
      FROM applications a
      LEFT JOIN candidates c ON a.candidate_id = c.id
      LEFT JOIN jobs j ON a.job_id = j.id
      WHERE a.follow_up_at IS NOT NULL
        AND ($1 <> 'application_engineer' OR a.assigned_to_user_id IS NOT DISTINCT FROM $2 OR ($3 IS NOT NULL AND a.assigned_to IS NOT DISTINCT FROM $3) OR ($4 IS NOT NULL AND a.assigned_to IS NOT DISTINCT FROM $4))
        AND ($5 = '' OR c.name ILIKE $6 OR j.title ILIKE $6 OR j.company ILIKE $6)
        AND ($7 = '' OR a.status = $7)
        AND ($8 = '' OR a.follow_up_at <= $8::date)
        AND ($9 = '' OR a.follow_up_at > $9::date)
      ORDER BY a.follow_up_at ASC
      OFFSET $10 LIMIT $11
    `;

    let dataResult: any = null;
    let dataError: any = null;
    try {
      dataResult = await query(dataSql, [userRole, userId, userEmail, userDisplayName, "", "%%", "", "", "", 0, 50]);
    } catch (e: any) {
      dataError = { message: e?.message, stack: e?.stack?.slice(0, 3000), code: e?.code, detail: e?.detail, hint: e?.hint, position: e?.position };
    }

    const statsBaseWhere = `
      a.follow_up_at IS NOT NULL
      AND ($1 <> 'application_engineer' OR a.assigned_to_user_id IS NOT DISTINCT FROM $2 OR ($3 IS NOT NULL AND a.assigned_to IS NOT DISTINCT FROM $3) OR ($4 IS NOT NULL AND a.assigned_to IS NOT DISTINCT FROM $4))
    `;
    const statsBaseParams = [userRole, userId, userEmail, userDisplayName];

    let statsResult: any = null;
    let statsError: any = null;
    try {
      statsResult = await Promise.all([
        queryOne(`SELECT COUNT(*)::int as total FROM applications a WHERE ${statsBaseWhere}`, statsBaseParams),
        queryOne(`SELECT COUNT(*)::int as total FROM applications a WHERE ${statsBaseWhere} AND a.follow_up_at <= $5::date`, [...statsBaseParams, today]),
        queryOne(`SELECT COUNT(*)::int as total FROM applications a WHERE ${statsBaseWhere} AND a.follow_up_at > $5::date`, [...statsBaseParams, today]),
        queryOne(`SELECT COUNT(*)::int as total FROM applications a WHERE ${statsBaseWhere} AND a.follow_up_source = 'auto_status_rule'`, statsBaseParams),
      ]);
    } catch (e: any) {
      statsError = { message: e?.message, stack: e?.stack?.slice(0, 3000), code: e?.code, detail: e?.detail, hint: e?.hint, position: e?.position };
    }

    return NextResponse.json({
      ok: true,
      cols,
      userRole,
      userId,
      userEmail,
      userDisplayName,
      dataResult,
      dataError,
      statsResult,
      statsError,
    });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err), stack: err?.stack?.slice(0, 3000) }, { status: 500 });
  }
}
