// src/lib/ai/digest.ts
// Single-shot AI digest: the app gathers a data snapshot itself (plain Supabase
// queries, no tool-calling), embeds it in one prompt, and asks for one summary.
// Deliberately NOT the multi-turn tool-calling pattern /api/chat uses — see
// ROADMAP.md for why that pattern is unreliable with the NVIDIA-hosted model in
// particular. This automation doesn't hit that failure mode because there's no
// second turn for the model to degenerate on.

import { supabase } from "@/lib/supabase";
import { getActiveProvider } from "@/lib/ai";
import { textOf } from "@/lib/ai/provider";

async function gatherSnapshot() {
  const since = new Date();
  since.setHours(0, 0, 0, 0);

  const [newJobsRes, overdueRes, recentAppsRes, pipelineRes] = await Promise.all([
    supabase.from("jobs").select("id", { count: "exact", head: true }).gte("created_at", since.toISOString()),
    supabase.from("applications").select("id, assignment_due_at, assigned_to, candidates(name), jobs(title)")
      .in("status", ["assigned", "stacked", "in_progress"])
      .lte("assignment_due_at", since.toISOString())
      .not("assignment_due_at", "is", null)
      .limit(20),
    supabase.from("applications").select("status, applied_at").gte("applied_at", since.toISOString()),
    supabase.from("applications").select("status").in("status", ["assigned", "stacked", "in_progress"]),
  ]);

  return {
    newJobsToday: newJobsRes.count ?? 0,
    overdueTickets: (overdueRes.data ?? []).map((t: any) => ({
      candidate: t.candidates?.name,
      job: t.jobs?.title,
      owner: t.assigned_to,
      dueAt: t.assignment_due_at,
    })),
    applicationsToday: (recentAppsRes.data ?? []).length,
    pipelineTicketCount: (pipelineRes.data ?? []).length,
  };
}

export async function generateDailyDigest(): Promise<{ content: string; provider: string } | { error: string }> {
  const active = getActiveProvider();
  if (!active) return { error: "No AI provider configured (set ANTHROPIC_API_KEY or NVIDIA_API_KEY)." };

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
