import type { AiProvider } from "@/lib/ai/provider";
import type { AgentOptions } from "@/lib/ai/application-agents/types";

export type JobCeoAgentId =
  | "job_ceo_orchestrator"
  | "job_ceo_scout"
  | "job_ceo_qa"
  | "job_ceo_deep_fetch"
  | "job_ceo_matchmaker"
  | "job_ceo_enricher";

export const JOB_CEO_AGENT_IDS: JobCeoAgentId[] = [
  "job_ceo_orchestrator",
  "job_ceo_scout",
  "job_ceo_qa",
  "job_ceo_deep_fetch",
  "job_ceo_matchmaker",
  "job_ceo_enricher",
];

export interface JobCeoAgentMeta {
  id: JobCeoAgentId;
  displayName: string;
  sequenceNumber: number;
  description: string;
}

export const JOB_CEO_AGENT_METAS: Record<JobCeoAgentId, JobCeoAgentMeta> = {
  job_ceo_orchestrator: {
    id: "job_ceo_orchestrator",
    displayName: "Job CEO",
    sequenceNumber: 0,
    description: "Plans runs and proposes agent tuning",
  },
  job_ceo_scout: {
    id: "job_ceo_scout",
    displayName: "Query Scout",
    sequenceNumber: 1,
    description: "Formulates search/Boolean terms",
  },
  job_ceo_qa: {
    id: "job_ceo_qa",
    displayName: "QA Bouncer",
    sequenceNumber: 2,
    description: "Filters raw jobs on a quality/relevance matrix",
  },
  job_ceo_deep_fetch: {
    id: "job_ceo_deep_fetch",
    displayName: "Deep Fetch",
    sequenceNumber: 3,
    description: "Scrapes full JD from source URL",
  },
  job_ceo_matchmaker: {
    id: "job_ceo_matchmaker",
    displayName: "Matchmaker",
    sequenceNumber: 4,
    description: "Matches jobs to candidates, logs + drafts outreach",
  },
  job_ceo_enricher: {
    id: "job_ceo_enricher",
    displayName: "Description Enricher",
    sequenceNumber: 5,
    description: "Backfills full job descriptions for logged jobs with thin/missing text, on a cron",
  },
};

export type JobCeoRunStatus =
  | "ingesting"
  | "qa"
  | "deep_fetch"
  | "matchmaking"
  | "completed"
  | "failed"
  | "cancelled";

export type StagedJobStage =
  | "ingested"
  | "qa_passed"
  | "qa_dropped"
  | "researched"
  | "matched"
  | "logged"
  | "error";

export interface StagedJob {
  id: string;
  run_id: string;
  stage: StagedJobStage;
  dedup_signature: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  source_url: string | null;
  external_job_id: string | null;
  snippet: string | null;
  description_text: string | null;
  raw: Record<string, unknown> | null;
  qa_score: number | null;
  qa_reason: string | null;
  requirements: Record<string, unknown> | null;
  match_results: Record<string, unknown> | null;
  logged_job_id: string | null;
  claimed_at: string | null;
  claim_expires_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobCeoAgentContext {
  runId: string;
  previousOutputs: Record<string, unknown>;
}

export type JobCeoAgentFunction<I, O> = (
  input: I,
  provider: AiProvider,
  context: JobCeoAgentContext
) => Promise<O>;

export type { AgentOptions } from "@/lib/ai/application-agents/types";
