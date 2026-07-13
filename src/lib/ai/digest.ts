// src/lib/ai/digest.ts
// Single-shot AI digest: the app gathers a data snapshot itself (plain Supabase
// queries, no tool-calling), embeds it in one prompt, and asks for one summary.
// Deliberately NOT the multi-turn tool-calling pattern /api/chat uses — see
// ROADMAP.md for why that pattern is unreliable with the NVIDIA-hosted model in
// particular. This automation doesn't hit that failure mode because there's no
// second turn for the model to degenerate on.

import { countJobsSince } from "@/server/repositories/jobsRepository";
import { listOverdueApplications, listApplicationsSince, countApplicationsByStatus } from "@/server/repositories/applicationsRepository";
import { callWithUsageTracking } from "@/lib/ai/routing";
import { textOf } from "@/lib/ai/provider";

async function gatherSnapshot() {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const sinceIso = since.toISOString();

  const [newJobsToday, overdueTickets, recentAppsRes, pipelineCount] = await Promise.all([
    countJobsSince(sinceIso),
    listOverdueApplications(20),
    listApplicationsSince(sinceIso),
    countApplicationsByStatus(["assigned", "stacked", "in_progress"]),
  ]);

  return {
    newJobsToday,
    overdueTickets: (overdueTickets ?? []).map((t: any) => ({
      candidate: t.candidates?.name,
      job: t.jobs?.title,
      owner: t.assigned_to,
      dueAt: t.assignment_due_at,
    })),
    applicationsToday: (recentAppsRes ?? []).length,
    pipelineTicketCount: pipelineCount,
  };
}

export interface DigestResult {
  content: string;
  provider: string;
  dataSummary: {
    newJobs: number;
    overdueTickets: number;
    activeWorkflows: number;
    failedWorkflows: number;
    pendingReviews: number;
    completedToday: number;
  };
}

export async function generateDailyDigest(): Promise<DigestResult | { error: string }> {
  const snapshot = await gatherSnapshot();

  let activeWorkflows = 0;
  let failedWorkflows = 0;
  let completedToday = 0;
  try {
    const { query } = await import("@/server/db/neon");
    const today = new Date().toISOString().slice(0, 10);
    const wfs = await query<{ status: string }>(
      `SELECT status FROM application_ai_workflows
       WHERE created_at >= $1::date AND created_at < ($1::date + interval '1 day')`,
      [today]
    );
    for (const wf of wfs ?? []) {
      if (wf.status === "completed") completedToday++;
      else if (wf.status === "failed") failedWorkflows++;
      else if (wf.status === "queued" || wf.status === "running" || wf.status === "waiting") activeWorkflows++;
    }
  } catch {}

  let pendingReviews = 0;
  try {
    const { query: q } = await import("@/server/db/neon");
    const revs = await q<{ count: number }>(
      `SELECT COUNT(*)::int FROM applications WHERE review_status = 'pending'`,
      []
    );
    pendingReviews = revs?.[0]?.count ?? 0;
  } catch {}

  const dataSummary = {
    newJobs: snapshot.newJobsToday,
    overdueTickets: (snapshot.overdueTickets ?? []).length,
    activeWorkflows,
    failedWorkflows,
    pendingReviews,
    completedToday,
  };

  const prompt = [
    "Write a short, plain-language daily digest (4-6 sentences, no headers/bullets) for an internal recruiting team based on this data snapshot:",
    JSON.stringify(snapshot),
    "Mention new jobs ingested today, how many overdue application tickets need attention (name them if there are 5 or fewer), applications submitted today, and how many tickets are still in the pipeline. If a number is zero, say so plainly rather than skipping it.",
  ].join("\n\n");

  try {
    const { result, providerName } = await callWithUsageTracking("ai_digest", undefined, async (provider) => {
      return provider.send({
        system: "You are a reporting assistant. Be concise and factual. Use only the data given to you.",
        messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
        tools: [],
      });
    });
    const content = textOf(result.content) || "(no content generated)";
    return { content, provider: providerName, dataSummary };
  } catch (err: any) {
    return { error: err.message ?? "digest generation failed" };
  }
}
