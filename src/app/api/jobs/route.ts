// src/app/api/jobs/route.ts
// GET  -> paginated/filterable masterlist of jobs, each with applicant count + names
// POST -> manually add one job

import { NextRequest, NextResponse } from "next/server";
import { MASTER_DATA_MANAGER_ROLES, requireCurrentUser } from "@/lib/auth";
import { categorizeJob } from "@/lib/jobCategorizer";
import { filterNewJobs } from "@/lib/jobDedup";
import { syncCompanyDirectoryFromJobs } from "@/lib/companyDirectory";
import { logActivity } from "@/lib/activity";
import { triggerWebhooks } from "@/lib/webhookEngine";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Excludes description_html/raw_source_payload/benefits/company_address — large
// HTML/JSON blobs only needed on the job detail page, not the list view. At 1,000+
// rows including them ballooned the list payload to 24MB on every page load.
const LIST_COLUMNS = `
  id, company_id, title, company, location, source, role_tier, salary_range, source_url, notes,
  is_active, seniority_level, employment_type, applicants_count, company_employees_count,
  company_website, posted_at, external_job_id, tracking_id, ref_id, apply_url,
  job_function, industries, input_url, company_linkedin_url,
  company_logo_url, company_slogan, job_poster_name, job_poster_title,
  job_poster_profile_url, job_poster_photo_url, job_category, category_tags,
  category_relevance_score, last_seen_at, created_at,
  applications(id, status, candidates(id, name, avatar_url))
`;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "50", 10) || 50));
  const search = (url.searchParams.get("search") || "").trim().replace(/[,()]/g, "");
  const source = url.searchParams.get("source") || "";
  const roleTier = url.searchParams.get("roleTier") || "";
  const active = url.searchParams.get("active") || "";
  const employmentType = url.searchParams.get("employmentType") || "";
  const category = url.searchParams.get("category") || "";
  const sort = url.searchParams.get("sort") || "";

  let query = supabase.from("jobs").select(LIST_COLUMNS, { count: "planned" });

  if (search) query = query.or(`title.ilike.%${search}%,company.ilike.%${search}%,location.ilike.%${search}%`);
  if (source) query = query.eq("source", source);
  if (roleTier) query = query.eq("role_tier", roleTier);
  if (active === "active") query = query.eq("is_active", true);
  if (active === "inactive") query = query.eq("is_active", false);
  if (employmentType) query = query.eq("employment_type", employmentType);
  if (category) query = query.or(`job_category.eq.${category},category_tags.cs.{"${category}"}`);

  if (sort === "posted_asc") query = query.order("posted_at", { ascending: true, nullsFirst: false });
  else if (sort === "posted_desc") query = query.order("posted_at", { ascending: false, nullsFirst: false });
  else query = query.order("created_at", { ascending: false });

  const from = (page - 1) * pageSize;
  const { data: jobs, error, count } = await query.range(from, from + pageSize - 1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Shape it so the dashboard gets a clean "applicant_count" + "applicants" list per job.
  const shaped = (jobs ?? []).map((job: any) => ({
    ...job,
    ...(job.job_category ? {} : categorizeJob([
      job.title,
      job.notes,
      job.job_function,
      job.industries,
    ])),
    applicant_count: job.applications?.length ?? 0,
    applicants: (job.applications ?? []).map((a: any) => ({
      application_id: a.id,
      candidate_id: a.candidates?.id,
      name: a.candidates?.name,
      avatar_url: a.candidates?.avatar_url,
      status: a.status,
    })),
  }));

  return NextResponse.json({ jobs: shaped, total: count ?? 0, page, pageSize });
}

export async function POST(req: NextRequest) {
  const { context, response } = await requireCurrentUser(MASTER_DATA_MANAGER_ROLES);
  if (response) return response;

  const body = await req.json();

  if (!body.title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const applicantsCount = body.applicants_count !== undefined && body.applicants_count !== null && body.applicants_count !== ""
    ? parseInt(String(body.applicants_count).replace(/[^\d]/g, ""), 10)
    : null;
  const row = {
    title: body.title,
    company: body.company ?? null,
    location: body.location ?? null,
    source: "manual",
    role_tier: body.role_tier ?? null,
    salary_range: body.salary_range ?? null,
    source_url: body.source_url ?? null,
    notes: body.notes ?? null,
    posted_at: body.posted_at || null,
    applicants_count: Number.isFinite(applicantsCount) ? applicantsCount : null,
    ...categorizeJob([body.title, body.notes]),
  };

  const { newRows } = await filterNewJobs([row]);
  if (newRows.length === 0) {
    return NextResponse.json(
      { error: "Duplicate job: same posting URL or same title, company, posted date, and applicant count." },
      { status: 409 }
    );
  }

  const { data, error } = await supabase
    .from("jobs")
    .insert(row)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await syncCompanyDirectoryFromJobs([data]);

  if (context && data) {
    await logActivity({
      userId: context.profile.user_id,
      actorName: context.profile.display_name || context.profile.email,
      type: "create",
      description: `Created job ${data.title}`,
      entityType: "job",
      entityId: data.id,
      entityName: data.title,
      metadata: { company: data.company },
    });
    void triggerWebhooks("job.created", {
      job_id: data.id,
      title: data.title,
      company: data.company,
      created_by: context.profile.user_id,
    });
  }

  return NextResponse.json(data, { status: 201 });
}
