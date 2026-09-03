// Phase 0 of the AI Resume Pipeline optimization plan
// (Planning MD Files/AI tailored Resume Pipeline Cost Optimization Plan 03-09-26.md).
//
// Read-only replay harness: pulls the most recent REAL applications that
// completed all 4 pipeline stages, re-runs one (or all) stage(s) fresh
// against the exact same stored inputs (config_snapshot + prior artifacts,
// built the same way applicationAiWorkflowService.ts's buildAgentContext()
// does), and diffs the fresh output against what was actually stored at the
// time. This is how every later phase in the plan proves "quality-neutral-
// or-better" before/after a prompt change, instead of trusting it by eye.
//
// NEVER writes to the database - only query()/queryOne() reads, plus the
// pure agent run functions (runJobLens/runResumeForge/runHiringPanel/
// runFinalPolish), none of which persist anything themselves. Re-running a
// stage DOES make a real AI provider call (real cost) for each sampled
// application, exactly like a live run would.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/replay-pipeline-sample.ts
//   STAGE=hiring_panel npx tsx --env-file=.env.local scripts/replay-pipeline-sample.ts
//   STAGE=resume_forge LIMIT=5 CANDIDATE_ID=<uuid> npx tsx --env-file=.env.local scripts/replay-pipeline-sample.ts
//
// STAGE: job_lens | resume_forge | hiring_panel | final_polish | all (default: all)
// LIMIT: how many recent completed applications to sample (default: 15)
// CANDIDATE_ID: restrict the sample to one candidate (optional)

import { query, queryOne } from "../src/server/db/neon";
import { callWithUsageTracking } from "../src/lib/ai/routing";
import { AGENT_CONFIG_DEFAULTS } from "../src/lib/ai/application-agents/constants";
import { runJobLens } from "../src/lib/ai/application-agents/jobLens";
import { runResumeForge } from "../src/lib/ai/application-agents/resumeForge";
import { runHiringPanel } from "../src/lib/ai/application-agents/hiringPanel";
import { runFinalPolish } from "../src/lib/ai/application-agents/finalPolish";
import type { AgentContext, AgentOptions, ApplicationAgentId, ArtifactRecord } from "../src/lib/ai/application-agents/types";
import type { AiProvider } from "../src/lib/ai/provider";

type StageKey = "job_lens" | "resume_forge" | "hiring_panel" | "final_polish";
const STAGE_TO_AGENT_ID: Record<StageKey, ApplicationAgentId> = {
  job_lens: "application_job_lens",
  resume_forge: "application_resume_forge",
  hiring_panel: "application_hiring_panel",
  final_polish: "application_final_polish",
};
const ALL_STAGES: StageKey[] = ["job_lens", "resume_forge", "hiring_panel", "final_polish"];

const stageArg = (process.env.STAGE ?? "all").trim().toLowerCase();
const stagesToReplay: StageKey[] = stageArg === "all" ? ALL_STAGES : (stageArg.split(",").map((s) => s.trim()) as StageKey[]);
for (const s of stagesToReplay) {
  if (!ALL_STAGES.includes(s)) {
    console.error(`Unknown STAGE "${s}". Valid values: ${ALL_STAGES.join(", ")}, all`);
    process.exit(1);
  }
}
const limit = Math.max(1, Math.min(50, Number(process.env.LIMIT ?? 15)));
const candidateIdFilter = process.env.CANDIDATE_ID?.trim() || null;

interface WorkflowRow {
  id: string;
  application_id: string;
  base_resume_id: string | null;
  config_snapshot: any;
  completed_at: string;
}
interface ArtifactRow {
  automation_id: string;
  sequence_number: number;
  schema_version: string;
  content_hash: string;
  data: unknown;
  created_at: string;
}

/** Mirrors applicationAiWorkflowService.ts's buildAgentContext() exactly - same live-job/live-baseResume overlay, same previousOutputs shape - so the replay sees exactly what a real run would have seen. */
async function buildAgentContext(wf: WorkflowRow, artifacts: ArtifactRow[]): Promise<AgentContext> {
  const snapshot = wf.config_snapshot ?? {};
  const outputsMap: Record<string, ArtifactRecord> = {};
  for (const a of artifacts) {
    outputsMap[a.automation_id] = {
      id: `${wf.id}:${a.automation_id}`,
      automationId: a.automation_id,
      sequenceNumber: a.sequence_number,
      schemaVersion: a.schema_version,
      contentHash: a.content_hash,
      data: a.data,
      createdAt: a.created_at,
    };
  }

  const canonicalJob = await queryOne<any>(
    `SELECT j.* FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.id = $1`,
    [wf.application_id]
  );
  const job = canonicalJob ? { ...(snapshot.job ?? {}), ...canonicalJob } : (snapshot.job ?? {});

  let baseResume = snapshot.baseResume ?? {};
  if (wf.base_resume_id) {
    const freshBase = await queryOne<{ content: unknown }>("SELECT content FROM base_resumes WHERE id = $1", [wf.base_resume_id]);
    if (freshBase?.content) baseResume = { ...baseResume, content: freshBase.content };
  }

  return {
    applicationId: wf.application_id,
    candidateId: snapshot.candidateId ?? "",
    job,
    baseResume,
    evidence: snapshot.evidence ?? [],
    verifiedSkills: snapshot.verifiedSkills ?? [],
    sourceOfTruth: snapshot.sourceOfTruth ?? null,
    previousOutputs: outputsMap,
  };
}

function agentOptionsFor(agentId: ApplicationAgentId): AgentOptions {
  const d = (AGENT_CONFIG_DEFAULTS as any)[agentId];
  return {
    temperature: d?.temperature,
    max_output_tokens: d?.maxOutputTokens,
    timeout_ms: d?.timeoutMs,
  };
}

async function runStage(stage: StageKey, options: AgentOptions, ctx: AgentContext): Promise<any> {
  const agentId = STAGE_TO_AGENT_ID[stage];
  const { result } = await callWithUsageTracking(agentId, { applicationId: ctx.applicationId }, async (provider: AiProvider) => {
    switch (stage) {
      case "job_lens": return runJobLens(options, provider, ctx);
      case "resume_forge": return runResumeForge(options, provider, ctx);
      case "hiring_panel": return runHiringPanel(options, provider, ctx);
      case "final_polish": return runFinalPolish(options, provider, ctx);
    }
  });
  return result;
}

/** A small, stage-specific summary of "the numbers that matter" - full JSON diffs are too noisy to read by eye; this is what a human actually compares. */
function summarize(stage: StageKey, output: any): Record<string, unknown> {
  if (!output) return { present: false };
  switch (stage) {
    case "job_lens":
      return {
        requiredSkillsCount: output.requiredSkills?.length ?? 0,
        preferredSkillsCount: output.preferredSkills?.length ?? 0,
        requirementAnalysisCount: Array.isArray(output.requirementAnalysis) ? output.requirementAnalysis.length : undefined,
      };
    case "resume_forge":
      return {
        experienceRoles: output.experience?.length ?? 0,
        bulletsPerRole: (output.experience ?? []).map((e: any) => e.bullets?.length ?? 0),
        skillCategories: output.skills?.length ?? 0,
        evidenceIdsCited: (output.experience ?? []).flatMap((e: any) => e.evidenceIds ?? []).length,
        changeLogEntries: output.changeLog?.length ?? 0,
        missingRequirements: output.missingRequirements?.length ?? 0,
      };
    case "hiring_panel":
      return {
        atsScore: output.atsScore,
        recruiterScore: output.recruiterScore,
        roleFitScore: output.roleFitScore,
        truthfulnessRisk: output.truthfulnessRisk,
        passFail: output.passFail,
        disposition: output.disposition,
        requiredEditsCount: output.requiredEdits?.length ?? 0,
        pageFit: output.pageFit ?? null,
      };
    case "final_polish":
      return {
        finalQaScore: output.finalQaScore,
        exportReady: output.exportReady,
        experienceRoles: output.experience?.length ?? 0,
        bulletsPerRole: (output.experience ?? []).map((e: any) => e.bullets?.length ?? 0),
        unresolvedWarningsCount: output.unresolvedWarnings?.length ?? 0,
      };
  }
}

function printDiff(label: string, before: Record<string, unknown>, after: Record<string, unknown>) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  let changed = false;
  for (const k of keys) {
    const b = JSON.stringify(before[k]);
    const a = JSON.stringify(after[k]);
    if (b !== a) {
      if (!changed) { console.log(`  ${label}:`); changed = true; }
      console.log(`    ${k}: ${b}  ->  ${a}`);
    }
  }
  if (!changed) console.log(`  ${label}: no change`);
}

async function main() {
  console.log(`Replaying stage(s): ${stagesToReplay.join(", ")} | sample size: ${limit}${candidateIdFilter ? ` | candidate: ${candidateIdFilter}` : ""}\n`);

  // completed_at IS NOT NULL matters twice over: Postgres sorts NULLs first
  // by default, and a small set of historical workflows (traced to a batch
  // of hand-rolled test/backfill runs, confirmed via their automation_id
  // values being raw UUIDs instead of "application_*" strings) have
  // status='completed' but no completed_at at all - without this filter
  // they silently dominate "most recent," even though they aren't a normal
  // pipeline run and have nothing comparable in application_ai_artifacts.
  const workflows = await query<WorkflowRow>(
    `SELECT w.id, w.application_id, w.base_resume_id, w.config_snapshot, w.completed_at
     FROM application_ai_workflows w
     JOIN applications a ON a.id = w.application_id
     WHERE w.status = 'completed'
       AND w.completed_at IS NOT NULL
       AND ($1::uuid IS NULL OR a.candidate_id = $1::uuid)
     ORDER BY w.completed_at DESC
     LIMIT $2`,
    [candidateIdFilter, limit]
  );

  if (workflows.length === 0) {
    console.log("No completed workflows found matching this sample - nothing to replay.");
    return;
  }
  console.log(`Sampled ${workflows.length} completed workflow(s).\n`);

  let sampleIndex = 0;
  for (const wf of workflows) {
    sampleIndex += 1;
    const jobRow = await queryOne<{ title: string; company: string | null }>(
      `SELECT j.title, j.company FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.id = $1`,
      [wf.application_id]
    );
    console.log(`[${sampleIndex}/${workflows.length}] application ${wf.application_id} - ${jobRow?.title ?? "?"} @ ${jobRow?.company ?? "?"}`);

    const artifacts = await query<ArtifactRow>(
      `SELECT automation_id, sequence_number, schema_version, content_hash, data, created_at
       FROM application_ai_artifacts WHERE workflow_id = $1 ORDER BY sequence_number`,
      [wf.id]
    );
    const storedByAgent: Record<string, any> = {};
    for (const a of artifacts) storedByAgent[a.automation_id] = a.data;

    for (const stage of stagesToReplay) {
      const agentId = STAGE_TO_AGENT_ID[stage];
      if (!(agentId in storedByAgent)) {
        // A handful of historical artifact rows have a raw UUID in
        // automation_id instead of the real "application_*" string (a
        // one-off debug/test batch, confirmed via a direct DB check - not
        // representative of normal runs). Skip rather than print a
        // misleading "before: undefined" diff for this sample.
        console.log(`  ${stage}: SKIPPED - no stored artifact found for this workflow under automation_id "${agentId}" (likely contaminated/test data for this sample)`);
        continue;
      }
      const before = summarize(stage, storedByAgent[agentId]);
      try {
        const ctx = await buildAgentContext(wf, artifacts);
        const fresh = await runStage(stage, agentOptionsFor(agentId), ctx);
        const after = summarize(stage, fresh);
        printDiff(stage, before, after);
      } catch (err: any) {
        console.log(`  ${stage}: REPLAY FAILED - ${err?.message ?? err}`);
      }
    }
    console.log("");
  }

  console.log("Replay complete. Nothing was written to the database.");
  console.log("Read 3-5 of the full diffs above manually before calling any phase done - this script catches shape/score drift, not tone or plausibility.");
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("Replay script failed:", err);
  process.exit(1);
});
