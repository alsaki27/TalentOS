import { query, queryOne } from "../src/server/db/neon";
import { callWithUsageTracking } from "../src/lib/ai/routing";
import { runHiringPanel } from "../src/lib/ai/application-agents/hiringPanel";
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
  const snapshot = wf.config_snapshot ?? {};
  let baseResume = snapshot.baseResume ?? {};
  if (wf.base_resume_id) {
    const fresh = await queryOne<any>("SELECT content FROM base_resumes WHERE id = $1", [wf.base_resume_id]);
    if (fresh?.content) baseResume = { ...baseResume, content: fresh.content };
  }
  const ctx = {
    applicationId: wf.application_id,
    candidateId: snapshot.candidateId ?? "",
    job: canonicalJob ? { ...(snapshot.job ?? {}), ...canonicalJob } : (snapshot.job ?? {}),
    baseResume,
    evidence: snapshot.evidence ?? [],
    verifiedSkills: snapshot.verifiedSkills ?? [],
    sourceOfTruth: snapshot.sourceOfTruth ?? null,
    previousOutputs: byAgent,
  };

  const options = { temperature: (AGENT_CONFIG_DEFAULTS as any).application_hiring_panel?.temperature, max_output_tokens: (AGENT_CONFIG_DEFAULTS as any).application_hiring_panel?.maxOutputTokens, timeout_ms: (AGENT_CONFIG_DEFAULTS as any).application_hiring_panel?.timeoutMs };
  const { result } = await callWithUsageTracking("application_hiring_panel", { applicationId: wf.application_id }, async (provider: AiProvider) => runHiringPanel(options, provider, ctx as any));

  console.log("pageFit (deterministic, computed by the runner regardless of prompt):", JSON.stringify(result.pageFit));
  console.log("\nformattingIssues:", JSON.stringify(result.formattingIssues, null, 2));
  console.log("\nrequiredEdits:", JSON.stringify(result.requiredEdits, null, 2));
  console.log("\noverallComment:", result.overallComment);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
