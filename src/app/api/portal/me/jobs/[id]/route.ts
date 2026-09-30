import { NextResponse } from "next/server";
import { requireCurrentCandidate } from "@/server/auth/candidateAuth";
import { queryOne } from "@/server/db/neon";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const { context, response } = await requireCurrentCandidate();
  if (response) return response;

  // A candidate may view only a job attached to one of their own applications.
  const job = await queryOne<Record<string, unknown>>(
    `SELECT j.id, j.title, j.company, j.location, j.source_url, j.apply_url,
            j.salary_range, j.employment_type, j.seniority_level, j.role_tier,
            j.description_text, j.benefits, j.job_function, j.industries,
            j.company_website, j.company_description, j.posted_at
     FROM jobs j
     WHERE j.id = $1
       AND EXISTS (
         SELECT 1 FROM applications a
         WHERE a.job_id = j.id AND a.candidate_id = $2
           AND CASE WHEN a.ae_stage = 'applied' THEN 'applied' ELSE a.status END NOT IN ('assigned', 'stacked', 'in_progress')
       )`,
    [params.id, context.candidateId],
  );

  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json(job);
}
