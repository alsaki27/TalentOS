// src/lib/ai/digest.ts
// Single-shot AI digest: the app gathers a data snapshot itself (plain Supabase
// queries, no tool-calling), embeds it in one prompt, and asks for one summary.
// Deliberately NOT the multi-turn tool-calling pattern /api/chat uses — see
// ROADMAP.md for why that pattern is unreliable with the NVIDIA-hosted model in
// particular. This automation doesn't hit that failure mode because there's no
// second turn for the model to degenerate on.

import { supabase } from "@/lib/supabase";
import { countJobsSince } from "@/server/repositories/jobsRepository";
import { listOverdueApplications, listApplicationsSince, countApplicationsByStatus } from "@/server/repositories/applicationsRepository";
import { getProviderForCategory } from "@/lib/ai";
import { textOf } from "@/lib/ai/provider";

async function gatherSnapshot() {
  const since = new Date();
  since.setHours(0, 0, 0, 0);
  const sinceIso = since.toISOString();

  const [newJobsToday, overdueTickets, recentAppsRes, pipelineCount] = await Promise.all([
    countJobsSince(sinceIso),
    listOverdueApplications(sinceIso, 20),
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

export async function generateDailyDigest(): Promise<{ content: string; provider: string } | { error: string }> {
  const active = await getProviderForCategory("content_generation");
  if (!active) return { error: "No AI provider configured (set ANTHROPIC_API_KEY, NVIDIA_API_KEY, or GOOGLE_API_KEY)." };

  const snapshot = await gatherSnapshot();

  const prompt = [
    "Write a short, plain-language daily digest (4-6 sentences, no headers/bullets) for an internal recruiting team based on this data snapshot:",
    JSON.stringify(snapshot),
    "Mention new jobs ingested today, how many overdue application tickets need attention (name them if there are 5 or fewer), applications submitted today, and how many tickets are still in the pipeline. If a number is zero, say so plainly rather than skipping it.",
  ].join("\n\n");

  try {
    const response = await active.provider.send({
      system: "You are a reporting assistant. Be concise and factual. Use only the data given to you.",
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
      tools: [],
    });
    const content = textOf(response.content) || "(no content generated)";
    return { content, provider: active.name };
  } catch (err: any) {
    return { error: err.message ?? "digest generation failed" };
  }
}
