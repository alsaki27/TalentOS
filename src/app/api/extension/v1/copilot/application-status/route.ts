import { NextRequest, NextResponse } from "next/server";
import { execute, queryOne } from "@/server/db/neon";
import { authenticateExtension, checkRequiredHeaders, EXTENSION_SCOPES, withExtensionCors } from "@/lib/extensionAuth";

export async function POST(request: NextRequest) {
  return withExtensionCors(async (req) => {
    const headerError = checkRequiredHeaders(req);
    if (headerError) return headerError;
    const auth = await authenticateExtension(req, EXTENSION_SCOPES.queueRead);
    if (auth instanceof NextResponse) return auth;
    try {
      const body = await req.json();
      const applicationId = String(body.applicationId || "").trim();
      if (!applicationId) return NextResponse.json({ error: { message: "applicationId is required" } }, { status: 400 });
      const existing = await queryOne<any>("SELECT id, status FROM applications WHERE id = $1", [applicationId]);
      if (!existing) return NextResponse.json({ error: { message: "Application not found" } }, { status: 404 });
      const now = new Date().toISOString();
      await execute(`UPDATE applications SET status = 'applied', ae_stage = 'applied', applied_at = COALESCE(applied_at, $2), ae_stage_updated_at = $2, next_action = NULL WHERE id = $1`, [applicationId, now]);
      await execute(`INSERT INTO application_events (application_id, from_status, to_status, note) VALUES ($1, $2, 'applied', $3)`, [applicationId, existing.status, "Detected application submission in browser"]);
      return NextResponse.json({ ok: true, applicationId, status: "applied", aeStage: "applied" });
    } catch (error: any) {
      return NextResponse.json({ error: { message: error?.message || "Could not update application" } }, { status: 500 });
    }
  });
}
