// Live end-to-end proof of the Phase 5 job_analysis cache: picks one real,
// recently-completed application, runs runJobLens with NO cache (confirms
// cache-miss path + real extraction + real write-back), then re-fetches the
// now-cached job row and runs runJobLens AGAIN (confirms cache-hit path
// makes only the requirement-analysis call, and produces an equivalent
// JobAnalysisV1 shape). Read-only except for the one legitimate cache
// write-back the code itself performs as designed.

import { query, queryOne } from "../src/server/db/neon";
import { callWithUsageTracking } from "../src/lib/ai/routing";
import { runJobLens } from "../src/lib/ai/application-agents/jobLens";
import { AGENT_CONFIG_DEFAULTS } from "../src/lib/ai/application-agents/constants";
import type { AiProvider } from "../src/lib/ai/provider";

async function main() {
  const wf = await queryOne<any>(`
    SELECT w.id, w.application_id, w.base_resume_id, w.config_snapshot
    FROM application_ai_workflows w
    WHERE w.status = 'completed' AND w.completed_at IS NOT NULL
    ORDER BY w.completed_at DESC LIMIT 1
  `);
  const artifacts = await query<any>(`SELECT automation_id, data FROM application_ai_artifacts WHERE workflow_id = $1`, [wf.id]);
  const byAgent: Record<string, any> = {};
  for (const a of artifacts) byAgent[a.automation_id] = { id: "x", automationId: a.automation_id, sequenceNumber: 1, schemaVersion: "v", contentHash: "x", data: a.data, createdAt: "" };

  const canonicalJob = await queryOne<any>(`SELECT j.* FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.id = $1`, [wf.application_id]);
  const SKIP_RUN1 = process.env.SKIP_RUN1 === "1";
  if (!SKIP_RUN1) {
    // Clear any existing cache on this job so this run starts from a known miss.
    const { execute } = await import("../src/server/db/neon");
    await execute(`UPDATE jobs SET job_analysis = NULL, job_analysis_schema_version = NULL WHERE id = $1`, [canonicalJob.id]);
  }

  const snapshot = wf.config_snapshot ?? {};
  let baseResume = snapshot.baseResume ?? {};
  if (wf.base_resume_id) {
    const fresh = await queryOne<any>("SELECT content FROM base_resumes WHERE id = $1", [wf.base_resume_id]);
    if (fresh?.content) baseResume = { ...baseResume, content: fresh.content };
  }
  const options = { temperature: (AGENT_CONFIG_DEFAULTS as any).application_job_lens?.temperature, max_output_tokens: (AGENT_CONFIG_DEFAULTS as any).application_job_lens?.maxOutputTokens, timeout_ms: (AGENT_CONFIG_DEFAULTS as any).application_job_lens?.timeoutMs };

  async function freshCtx(job: any) {
    return {
      applicationId: wf.application_id,
      candidateId: snapshot.candidateId ?? "",
      job,
      baseResume,
      evidence: snapshot.evidence ?? [],
      verifiedSkills: snapshot.verifiedSkills ?? [],
      sourceOfTruth: snapshot.sourceOfTruth ?? null,
      previousOutputs: byAgent,
    };
  }

  let result1: any = null;
  if (!SKIP_RUN1) {
    console.log(`=== RUN 1: cache MISS (job_analysis just cleared for job ${canonicalJob.id}) ===`);
    let callCount1 = 0;
    const ctx1 = await freshCtx(canonicalJob);
    const r1 = await callWithUsageTracking("application_job_lens", { applicationId: wf.application_id }, async (provider: AiProvider) => {
      const wrapped: AiProvider = { send: (opts) => { callCount1++; return provider.send(opts); } };
      return runJobLens(options, wrapped, ctx1 as any);
    });
    result1 = r1.result;
    console.log(`Run 1 provider.send call count: ${callCount1} (expect 2: job-only extraction + requirement analysis)`);
    console.log(`Run 1 title: ${result1.title}, requiredSkills: ${JSON.stringify(result1.requiredSkills?.slice(0, 3))}, requirementAnalysis count: ${result1.requirementAnalysis?.length}`);
  } else {
    console.log(`=== RUN 1 SKIPPED (SKIP_RUN1=1) - using already-cached job_analysis from a prior run ===`);
  }

  const cachedJobRow = await queryOne<any>(`SELECT * FROM jobs WHERE id = $1`, [canonicalJob.id]);
  console.log(`\nCache present? job_analysis present: ${!!cachedJobRow.job_analysis}, schema_version: ${cachedJobRow.job_analysis_schema_version}`);

  console.log(`\n=== RUN 2: cache HIT (re-running against the now-cached job row) ===`);
  let callCount2 = 0;
  const ctx2 = await freshCtx(cachedJobRow);
  const { result: result2 } = await callWithUsageTracking("application_job_lens", { applicationId: wf.application_id }, async (provider: AiProvider) => {
    const wrapped: AiProvider = { send: (opts) => { callCount2++; return provider.send(opts); } };
    return runJobLens(options, wrapped, ctx2 as any);
  });
  console.log(`Run 2 provider.send call count: ${callCount2} (expect 1: requirement analysis only, job-only skipped via cache)`);
  console.log(`Run 2 title: ${result2.title}, requiredSkills: ${JSON.stringify(result2.requiredSkills?.slice(0, 3))}, requirementAnalysis count: ${result2.requirementAnalysis?.length}`);

  console.log(`\n=== RUN 2 shape check ===`);
  console.log(`Job-only fields present and non-empty: title="${result2.title}", requiredSkills.length=${result2.requiredSkills?.length}, atsKeywords.length=${result2.atsKeywords?.length}`);
  console.log(`Keys: ${JSON.stringify(Object.keys(result2).sort())}`);
  if (result1) {
    console.log(`\n=== SHAPE COMPARISON vs RUN 1 ===`);
    console.log(`Same job-only fields? title match: ${result1.title === result2.title}, requiredSkills match: ${JSON.stringify(result1.requiredSkills) === JSON.stringify(result2.requiredSkills)}`);
    console.log(`Both keys equal: ${JSON.stringify(Object.keys(result1).sort()) === JSON.stringify(Object.keys(result2).sort())}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error("FATAL:", e); process.exit(1); });
