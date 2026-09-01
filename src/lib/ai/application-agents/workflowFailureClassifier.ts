// Turns a raw application_ai_workflows.last_error string into a
// human-readable explanation, for anyone (not just an engineer reading logs)
// to understand why a resume generation failed - shown on the AI pipeline
// board, the Application Queue, and a logged job's own application record.
//
// Pure and string-based on purpose: this is for DISPLAY only. Whether a
// retry should actually be *allowed* is a separate question decided by
// re-checking the live precondition (see checkWorkflowRetryBlocked in
// applicationAiWorkflowService.ts), never by trusting this frozen error
// text - a job that had no description yesterday may have one today.

export type WorkflowFailureCategory =
  | "missing_job_description"
  | "missing_target_job"
  | "infra_transient"
  | "other";

export interface WorkflowFailureClassification {
  category: WorkflowFailureCategory;
  /** Plain-language explanation, safe to show to anyone reviewing this application. */
  reason: string;
  /** Best-effort read from the error text alone - the authoritative answer for whether
   *  a retry is currently allowed comes from checkWorkflowRetryBlocked, not this flag. */
  likelyRetriable: boolean;
}

// Matches the exact prefixes/patterns the pipeline itself throws - see
// jobLens.ts ("Job Lens failed: no job description found for"),
// finalizationService.ts ("No target_job found for candidate"), and the
// orphaned-claim message in applicationAiWorkflowService.ts's dispatcher -
// so this stays in lockstep with the pipeline's own wording instead of
// guessing at it independently.
const CLOUDFLARE_STATUS_PATTERN = /\((5(0[0-9]|1[0-9]|2[0-9]|3[0-9]))\)/; // 500-539: gateway/tunnel-class errors (530, 524, etc.)

export function classifyWorkflowFailure(lastError: string | null | undefined): WorkflowFailureClassification | null {
  const message = (lastError ?? "").trim();
  if (!message) return null;

  if (message.includes("no job description found")) {
    return {
      category: "missing_job_description",
      reason: "This job posting has no description text on file, so it can't be analyzed. Add a description to the job posting, then retry.",
      likelyRetriable: false,
    };
  }

  if (message.startsWith("No target_job found for candidate")) {
    return {
      category: "missing_target_job",
      reason: "This application is missing an internal job-tracking link needed to finish the resume. This needs to be reconnected before retrying.",
      likelyRetriable: false,
    };
  }

  if (
    message.includes("orphaned without completing or erroring cleanly") ||
    message.includes("timed out") ||
    message.toLowerCase().includes("timeout") ||
    CLOUDFLARE_STATUS_PATTERN.test(message)
  ) {
    return {
      category: "infra_transient",
      reason: "This failed because of a temporary connection issue reaching the AI provider, not a problem with this application's data. Retrying should work once the provider is stable again.",
      likelyRetriable: true,
    };
  }

  return {
    category: "other",
    reason: message,
    likelyRetriable: true,
  };
}
