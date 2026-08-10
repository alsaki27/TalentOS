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
      const existing = await queryOne<any>("SELECT id, status, ae_stage FROM applications WHERE id = $1", [applicationId]);
      if (!existing) return NextResponse.json({ error: { message: "Application not found" } }, { status: 404 });
      const now = new Date().toISOString();
      await execute(`UPDATE applications SET status = 'applied', ae_stage = 'applied', application_stage = 'applied', applied_at = COALESCE(applied_at, $2), ae_stage_updated_at = $2, application_stage_changed_at = $2, ae_stage_updated_by_name = 'TalentOS Copilot', application_stage_changed_by_name = 'TalentOS Copilot', next_action = NULL WHERE id = $1`, [applicationId, now]);
      await execute(`INSERT INTO application_events (application_id, from_status, to_status, note) VALUES ($1, $2, 'applied', $3)`, [applicationId, existing.status, "Detected application submission in browser"]);
      await execute(`INSERT INTO application_stage_history (application_id, from_stage, to_stage, changed_at, changed_by_name, reason, source) VALUES ($1, $2, 'applied', $3, 'TalentOS Copilot', $4, 'extension')`, [applicationId, existing.ae_stage ?? null, now, "Detected application submission in browser"]);
      return NextResponse.json({ ok: true, applicationId, status: "applied", aeStage: "applied" });
    } catch (error: any) {
      return NextResponse.json({ error: { message: error?.message || "Could not update application" } }, { status: 500 });
    }
  })(request);
}

export async function OPTIONS(request: NextRequest) {
  return withExtensionCors(async () => new NextResponse(null, { status: 204 }))(request);
}
