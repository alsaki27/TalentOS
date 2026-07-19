// Shared agent contracts for the multi-agent application pipeline.
// Every agent input/output has a runtime-validated schema.

import type { AiProvider } from "@/lib/ai/provider";

// ── Agent identifiers ──

export type ApplicationAgentId =
  | "application_job_lens"
  | "application_resume_forge"
  | "application_hiring_panel"
  | "application_final_polish"
  | "copilot_fill_planner"
  | "copilot_question_answerer";

export const APPLICATION_AGENT_IDS: ApplicationAgentId[] = [
  "application_job_lens",
  "application_resume_forge",
  "application_hiring_panel",
  "application_final_polish",
  "copilot_fill_planner",
  "copilot_question_answerer"
];

export interface ApplicationAgentMeta {
  id: ApplicationAgentId;
  displayName: string;
  sequenceNumber: number;
  description: string;
}

export const APPLICATION_AGENT_METAS: Record<ApplicationAgentId, ApplicationAgentMeta> = {
  application_job_lens: {
    id: "application_job_lens",
    displayName: "Job Lens",
    sequenceNumber: 1,
    description: "Analyze the JD and extract requirements",
  },
  application_resume_forge: {
    id: "application_resume_forge",
    displayName: "Resume Forge",
    sequenceNumber: 2,
    description: "Produce an evidence-supported tailored draft",
  },
  application_hiring_panel: {
    id: "application_hiring_panel",
    displayName: "Hiring Panel",
    sequenceNumber: 3,
    description: "Grade as recruiter, HR manager, and ATS",
  },
  application_final_polish: {
    id: "application_final_polish",
    displayName: "Final Polish",
    sequenceNumber: 4,
    description: "Apply approved feedback and run final QA",
  },
  copilot_fill_planner: {
    id: "copilot_fill_planner",
    displayName: "Copilot Fill Planner",
    sequenceNumber: 5,
    description: "Plan auto-fill for extension",
  },
  copilot_question_answerer: {
    id: "copilot_question_answerer",
    displayName: "Copilot Question Answerer",
    sequenceNumber: 6,
    description: "Answer custom application questions",
  },
};

// ── Workflow status ──

export type WorkflowStatus = "queued" | "running" | "waiting" | "failed" | "cancelled" | "completed";
export type StageRunStatus = "pending" | "running" | "success" | "failed" | "skipped" | "cancelled";

// ── Provider snapshot ──

export interface ProviderSnapshot {
  providerName: string;
  aiKeyId: string | null;
  model: string | null;
  routeRank: number | null;
}

// ── Agent context (passed into every agent) ──

export interface AgentContext {
  applicationId: string;
  candidateId: string;
  job: AgentJobData;
  baseResume: AgentResumeData;
  evidence: AgentEvidenceItem[];
  // Candidate Truth Ledger: recruiter-confirmed skills (candidates.verified_skills)
  // that supplement candidate_evidence's narrative entries - a fast-path source
  // of truth for skills that are real but weren't written into the base resume
  // text or documented as a full evidence entry.
  verifiedSkills: string[];
  previousOutputs: Record<string, ArtifactRecord>;
}

export interface AgentJobData {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  description: string | null;
  rawDescription: string | null;
  employmentType: string | null;
  seniorityLevel: string | null;
  salaryRange: string | null;
}

export interface AgentResumeData {
  id: string;
  title: string | null;
  content: unknown;
  skills: string[];
  experience: {
    title: string;
    company: string;
    startDate: string | null;
    endDate: string | null;
    bullets: string[];
  }[];
  education: {
    degree: string;
    school: string;
    field: string | null;
    graduationDate: string | null;
  }[];
  certifications: string[];
}

export interface AgentEvidenceItem {
  id: string;
  title: string;
  description: string;
  relatedSkills: string[];
  confidenceScore: number;
  source: string;
}

// ── Artifact record (immutable, versioned output) ──

export interface ArtifactRecord {
  id: string;
  automationId: string;
  sequenceNumber: number;
  schemaVersion: string;
  contentHash: string;
  data: unknown;
  createdAt: string;
}

// ── Stage run record ──

export interface StageRunRecord {
  id: string;
  workflowId: string;
  automationId: string;
  sequenceNumber: number;
  attemptNumber: number;
  status: StageRunStatus;
  providerSnapshot: ProviderSnapshot | null;
  promptVersion: string | null;
  inputArtifactId: string | null;
  outputArtifactId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
  latencyMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

// ── Agent function signature ──

export interface AgentOptions {
  system_prompt?: string;
  temperature?: number;
  max_output_tokens?: number;
  timeout_ms?: number;
}

export type AgentFunction<I, O> = (
  input: I,
  provider: AiProvider,
  context: AgentContext
) => Promise<O>;
