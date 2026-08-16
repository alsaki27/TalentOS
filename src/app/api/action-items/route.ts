import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { query } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { response } = await requireCurrentUser();
  if (response) return response;

  const url = new URL(req.url);
  const status = url.searchParams.get("status") || "open";

  const rows = await query<any>(
    `SELECT ai.*, c.name as candidate_name, c.id as candidate_id,
        jsonb_build_object('id', a.id, 'status', a.status, 'job_title', j.title, 'company', j.company) as application,
        ec.from_email as email_from, ec.ai_category as email_category,
        ec.ai_confidence as email_confidence, ec.suppression_rule,
        ec.ai_matched_application_id as matched_application_id
     FROM action_items ai
     JOIN candidates c ON ai.candidate_id = c.id
     LEFT JOIN applications a ON ai.application_id = a.id
     LEFT JOIN jobs j ON a.job_id = j.id
     LEFT JOIN email_communications ec ON ec.id = ai.email_communication_id
     WHERE ai.status = $1
     ORDER BY
       CASE ai.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
       ai.created_at DESC
     LIMIT 200`,
    [status]
  );

  return NextResponse.json({ items: rows ?? [] });
}
