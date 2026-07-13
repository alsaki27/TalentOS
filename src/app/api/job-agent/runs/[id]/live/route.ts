import { NextRequest, NextResponse } from "next/server";
import { getRunById } from "@/server/repositories/jobAgentRunRepository";
import { getTokenById } from "@/server/repositories/jobAgentTokenRepository";
import { fetchLiveApifyDatasetItems } from "@/server/services/jobAgentService";
import { requireCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const run = await getRunById(params.id);
    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });

    if (!run.apify_dataset_id || !run.token_id) {
      return NextResponse.json({ items: [] });
    }

    const token = await getTokenById(run.token_id);
    if (!token) return NextResponse.json({ error: "Token error" }, { status: 500 });

    const items = await fetchLiveApifyDatasetItems(run.apify_dataset_id, token, 100);
    
    return NextResponse.json({
      status: run.status,
      items: items.map(item => ({
        title: item.job_title ?? item.title ?? "Unknown Role",
        company: item.company_name ?? item.company ?? "Unknown Company",
        location: item.location ?? "Remote / Unknown",
        salary: item.salary_range ?? item.salary ?? "",
        date: item.date_posted ?? item.posted_at ?? ""
      }))
    });
  } catch (err: any) {
    console.error("[live feed error]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
