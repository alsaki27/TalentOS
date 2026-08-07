import { NextRequest, NextResponse } from "next/server";
import { requireCurrentUser } from "@/lib/auth";
import { queryOne, execute } from "@/server/db/neon";
import { createApplications } from "@/server/repositories/applicationsRepository";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentUser();
  if (response) return response;
  const body = await req.json().catch(() => ({}));
  const jobTitle = String(body.jobTitle || "").trim().slice(0, 300);
  const company = String(body.company || "").trim().slice(0, 300);
  const applyUrl = String(body.applyUrl || "").trim().slice(0, 1000) || null;
  if (!jobTitle || !company) return NextResponse.json({ error: "Company and job title are required." }, { status: 400 });

  const task = await queryOne<{ id: string; candidate_id: string; email_communication_id: string | null; application_id: string | null }>(
    "SELECT id, candidate_id, email_communication_id, application_id FROM action_items WHERE id = $1 AND type = 'untracked_application' AND status IN ('open', 'in_progress')",
    [params.id]
  );
  if (!task) return NextResponse.json({ error: "Untracked application task not found or already resolved." }, { status: 404 });

  let job = await queryOne<{ id: string }>("SELECT id FROM jobs WHERE LOWER(title) = LOWER($1) AND LOWER(COALESCE(company, '')) = LOWER($2) LIMIT 1", [jobTitle, company]);
  if (!job) {
    job = await queryOne<{ id: string }>(
      `INSERT INTO jobs (title, company, source, apply_url, source_url, notes)
       VALUES ($1, $2, 'email_confirmation', $3, $3, 'Created from an application confirmation email; verify details.') RETURNING id`,
      [jobTitle, company, applyUrl]
    );
  }
  if (!job) return NextResponse.json({ error: "Could not create job record." }, { status: 500 });

  const existing = await queryOne<{ id: string }>("SELECT id FROM applications WHERE candidate_id = $1 AND job_id = $2", [task.candidate_id, job.id]);
  const application = existing || (await createApplications([{
    candidate_id: task.candidate_id,
    job_id: job.id,
    status: "applied",
    source_type: "email_confirmation",
    notes: "Manually added by AE after TalentOS detected an external application confirmation.",
    created_by: context!.profile.user_id,
  }]))[0];
  if (!application) return NextResponse.json({ error: "Could not create application record." }, { status: 500 });

  await execute("UPDATE action_items SET application_id = $1, status = 'done', resolved_at = now(), resolved_by_user_id = $2, resolution_kind = 'manual_resolution', resolution_note = $3 WHERE id = $4", [application.id, context!.profile.user_id, `AE added application: ${company} — ${jobTitle}`, task.id]);
  await execute("INSERT INTO candidate_workflow_events (candidate_id, application_id, action_item_id, email_communication_id, event_type, actor_type, actor_user_id, payload) VALUES ($1, $2, $3, $4, 'untracked_application_added', 'ae', $5, $6)", [task.candidate_id, application.id, task.id, task.email_communication_id, context!.profile.user_id, JSON.stringify({ company, jobTitle, applyUrl })]);
  return NextResponse.json({ ok: true, applicationId: application.id, jobId: job.id });
}
