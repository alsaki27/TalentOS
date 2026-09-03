// Pinned version of verify_cache_hit_live.ts: uses a specific, already-known
// job/application (not "most recent", which drifts as real production
// traffic completes new workflows during this session) to deterministically
// verify the cache-HIT path: exactly 1 provider.send() call, and a valid,
// complete JobAnalysisV1 result.

import { query, queryOne } from "../src/server/db/neon";
import { callWithUsageTracking } from "../src/lib/ai/routing";
import { runJobLens } from "../src/lib/ai/application-agents/jobLens";
import { AGENT_CONFIG_DEFAULTS } from "../src/lib/ai/application-agents/constants";
import type { AiProvider } from "../src/lib/ai/provider";

const APPLICATION_ID = "a3909099-e1f2-4ce7-ba55-0a13091b828b";
const WORKFLOW_ID = "12f82ac5-2758-49a4-9dc5-fb3ab1f8eaa3";
const BASE_RESUME_ID = "2b96b916-cbff-483a-8d17-2b805bc669cf";
const JOB_ID = "9901ae99-4408-4d0a-8447-b3eb66ca614d";

async function main() {
  const wf = await queryOne<any>(`SELECT id, application_id, base_resume_id, config_snapshot FROM application_ai_workflows WHERE id = $1`, [WORKFLOW_ID]);
  const artifacts = await query<any>(`SELECT automation_id, data FROM application_ai_artifacts WHERE workflow_id = $1`, [wf.id]);
  const byAgent: Record<string, any> = {};
  for (const a of artifacts) byAgent[a.automation_id] = { id: "x", automationId: a.automation_id, sequenceNumber: 1, schemaVersion: "v", contentHash: "x", data: a.data, createdAt: "" };

  const jobRow = await queryOne<any>(`SELECT * FROM jobs WHERE id = $1`, [JOB_ID]);
  console.log(`Job ${JOB_ID} cache state: schema_version=${jobRow.job_analysis_schema_version}, has_analysis=${!!jobRow.job_analysis}`);

  const snapshot = wf.config_snapshot ?? {};
  const baseResumeRow = await queryOne<any>("SELECT content FROM base_resumes WHERE id = $1", [BASE_RESUME_ID]);
  const baseResume = { ...(snapshot.baseResume ?? {}), content: baseResumeRow?.content ?? snapshot.baseResume?.content };

  const ctx = {
    applicationId: APPLICATION_ID,
    candidateId: snapshot.candidateId ?? "",
    job: jobRow,
    baseResume,
    evidence: snapshot.evidence ?? [],
    verifiedSkills: snapshot.verifiedSkills ?? [],
    sourceOfTruth: snapshot.sourceOfTruth ?? null,
    previousOutputs: byAgent,
  };
  const options = { temperature: (AGENT_CONFIG_DEFAULTS as any).application_job_lens?.temperature, max_output_tokens: (AGENT_CONFIG_DEFAULTS as any).application_job_lens?.maxOutputTokens, timeout_ms: (AGENT_CONFIG_DEFAULTS as any).application_job_lens?.timeoutMs };

  let callCount = 0;
  const { result } = await callWithUsageTracking("application_job_lens", { applicationId: APPLICATION_ID }, async (provider: AiProvider) => {
    const wrapped: AiProvider = { send: (opts) => { callCount++; return provider.send(opts); } };
    return runJobLens(options, wrapped, ctx as any);
  });

  console.log(`\nprovider.send call count: ${callCount} (expect 1 for a cache HIT - job-only extraction skipped)`);
  console.log(`title: ${result.title}`);
  console.log(`requiredSkills.length: ${result.requiredSkills?.length}`);
  console.log(`atsKeywords.length: ${result.atsKeywords?.length}`);
  console.log(`requirementAnalysis.length: ${result.requirementAnalysis?.length}`);
  console.log(`requirementAnalysis sample: ${JSON.stringify(result.requirementAnalysis?.slice(0, 2), null, 2)}`);
  console.log(`\nAll JobAnalysisV1 keys present: ${JSON.stringify(Object.keys(result).sort())}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error("FATAL:", e); process.exit(1); });
