import { NextRequest, NextResponse } from "next/server";
import { requirePublicApiScope } from "@/lib/publicApiAuth";
import { supabase } from "@/lib/supabase";

function rate(count: number, total: number): number {
  return total === 0 ? 0 : Math.round((count / total) * 1000) / 10;
}

export async function GET(req: NextRequest) {
  const { response } = await requirePublicApiScope(req, "analytics:read");
  if (response) return response;

  const [candidatesRes, jobsRes, applicationsRes] = await Promise.all([
    supabase.from("candidates").select("id", { count: "exact", head: true }),
    supabase.from("jobs").select("id, source, company_id"),
    supabase.from("applications").select("id, status, job_id, priority, review_status"),
  ]);

  if (jobsRes.error) return NextResponse.json({ error: jobsRes.error.message }, { status: 500 });
  if (applicationsRes.error) return NextResponse.json({ error: applicationsRes.error.message }, { status: 500 });

  const jobs = jobsRes.data ?? [];
  const allApplications = applicationsRes.data ?? [];
  const pipelineStatuses = new Set(["assigned", "stacked", "in_progress"]);
  const submitted = allApplications.filter((app: any) => !pipelineStatuses.has(app.status as string));
  const respondedCount = submitted.filter((app: any) => app.status !== "applied").length;
  const interviewCount = submitted.filter((app: any) => app.status === "interview" || app.status === "offer").length;
  const offerCount = submitted.filter((app: any) => app.status === "offer").length;

  return NextResponse.json({
    totals: {
      candidates: candidatesRes.count ?? 0,
      jobs: jobs.length,
      applications: submitted.length,
      pipelineTickets: allApplications.length - submitted.length,
      companies: new Set(jobs.map((job: any) => job.company_id as string).filter(Boolean)).size,
    },
    rates: {
      responseRate: rate(respondedCount, submitted.length),
      interviewRate: rate(interviewCount, submitted.length),
      offerRate: rate(offerCount, submitted.length),
    },
    statusBreakdown: (() => {
      const acc: Record<string, number> = {};
      for (const app of allApplications) {
        acc[(app as any).status as string] = (acc[(app as any).status as string] ?? 0) + 1;
      }
      return acc;
    })(),
    priorityBreakdown: (() => {
      const acc: Record<string, number> = {};
      for (const app of allApplications) {
        const key = (app as any).priority as string || "normal";
        acc[key] = (acc[key] ?? 0) + 1;
      }
      return acc;
    })(),
  });
}
