// Agent constants and configuration defaults.
//
// timeoutMs retuned 2026-09 against real ai_usage_events latency for
// *successful* calls (trailing 7 days, outcome = 'success'). The prior
// values left almost no margin above observed real-world max latency
// (job_lens/hiring_panel max ~119.3-119.7s against a 120s timeout;
// final_polish max ~179.2s against a 180s timeout - under 1s of headroom),
// meaning a real, successful-but-slow call could be aborted right at the
// finish line and counted as a timeout failure. New values add real margin
// above the observed max, not just the p99, so a genuinely successful call
// is never cut off:
//   job_lens:      p99 106s / max 120s  -> 150s (was 120s)
//   resume_forge:  p99  75s / max 115s  -> unchanged, 180s already generous
//   hiring_panel:  p99 103s / max 119s  -> 150s (was 120s)
//   final_polish:  p99 157s / max 179s  -> 220s (was 180s)

export const AGENT_CONFIG_DEFAULTS = {
  application_job_lens: {
    displayName: "Job Lens",
    temperature: 0.2,
    maxOutputTokens: 32768,
    timeoutMs: 150_000,
    maxAttempts: 2,
    approvalPolicy: "auto" as const,
    minimumScore: 0,
  },
  application_resume_forge: {
    displayName: "Resume Forge",
    temperature: 0.3,
    maxOutputTokens: 32768,
    timeoutMs: 180_000,
    maxAttempts: 2,
    approvalPolicy: "risk_based" as const,
    minimumScore: 0,
  },
  application_hiring_panel: {
    displayName: "Hiring Panel",
    temperature: 0.1,
    maxOutputTokens: 32768,
    timeoutMs: 150_000,
    maxAttempts: 2,
    approvalPolicy: "auto" as const,
    minimumScore: 6.0,
  },
  application_final_polish: {
    displayName: "Final Polish",
    temperature: 0.2,
    maxOutputTokens: 32768,
    timeoutMs: 220_000,
    maxAttempts: 2,
    approvalPolicy: "auto" as const,
    minimumScore: 0,
  },
  copilot_fill_planner: {
    displayName: "Copilot Fill Planner",
    temperature: 0.1,
    maxOutputTokens: 4096,
    timeoutMs: 45_000,
    maxAttempts: 2,
    approvalPolicy: "auto" as const,
    minimumScore: 0,
  },
  copilot_question_answerer: {
    displayName: "Copilot Question Answerer",
    temperature: 0.4,
    maxOutputTokens: 2048,
    timeoutMs: 20_000,
    maxAttempts: 2,
    approvalPolicy: "auto" as const,
    minimumScore: 0,
  },
  copilot_ceo: {
    displayName: "Copilot CEO",
    temperature: 0.2,
    maxOutputTokens: 4096,
    timeoutMs: 60_000,
    maxAttempts: 1,
    approvalPolicy: "auto" as const,
    minimumScore: 0,
  },
  copilot_form_analyst: {
    displayName: "Copilot Form Analyst",
    temperature: 0.1,
    maxOutputTokens: 1024,
    timeoutMs: 15_000,
    maxAttempts: 2,
    approvalPolicy: "auto" as const,
    minimumScore: 0,
  },
  copilot_compliance: {
    displayName: "Copilot Compliance",
    temperature: 0.0,
    maxOutputTokens: 2048,
    timeoutMs: 15_000,
    maxAttempts: 2,
    approvalPolicy: "auto" as const,
    minimumScore: 0,
  },
  copilot_correction_reviewer: {
    displayName: "Copilot Correction Reviewer",
    temperature: 0.1,
    maxOutputTokens: 1024,
    timeoutMs: 15_000,
    maxAttempts: 1,
    approvalPolicy: "auto" as const,
    minimumScore: 0,
  },
  copilot_cover_letter: {
    displayName: "Copilot Cover Letter",
    temperature: 0.5,
    maxOutputTokens: 4096,
    timeoutMs: 45_000,
    maxAttempts: 2,
    approvalPolicy: "auto" as const,
    minimumScore: 0,
  },
  application_job_hunter: {
    displayName: "Job Hunter",
    temperature: 0.1,
    maxOutputTokens: 8192,
    timeoutMs: 30000,
    maxAttempts: 2,
    approvalPolicy: "auto" as const,
    minimumScore: 0,
  },
} as const;

export const SCHEMA_VERSIONS = {
  jobAnalysis: "JobAnalysisV1",
  // Distinct from jobAnalysis above: this versions jobs.job_analysis's cached
  // shape (JobOnlyAnalysisV1 - job-only fields, no requirementAnalysis), not
  // the full per-application JobAnalysisV1 runJobLens returns. A future
  // change to the job-only field set bumps this independently, so a stale
  // cache entry is detected and re-extracted rather than silently merged
  // with a shape it no longer matches.
  jobOnlyAnalysis: "JobOnlyAnalysisV1",
  resumeDraft: "ResumeDraftV1",
  reviewScore: "ReviewScoreV1",
  finalResume: "FinalResumeV1",
} as const;
