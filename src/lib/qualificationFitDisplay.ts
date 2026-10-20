export interface MissingQualificationFitDisplay {
  label: string;
  tone: "badge-info" | "badge-warning";
  title: string;
}

/** Explain why a queue row has no Qualification fit scorecard. */
export function missingQualificationFitDisplay(
  workflowStatus: string | null | undefined,
  expectedRubricVersion: string | null | undefined,
): MissingQualificationFitDisplay {
  if (workflowStatus === "completed") {
    if (expectedRubricVersion) {
      return {
        label: "Fit: scorecard missing",
        tone: "badge-warning",
        title: "This workflow started with Qualification fit scoring enabled, but its scorecard was not saved. Check the workflow finalization logs.",
      };
    }
    return {
      label: "Fit: legacy",
      tone: "badge-info",
      title: "No Qualification fit scorecard is stored. Older completed workflows are not recalculated automatically; if this run is recent, check its finalization logs.",
    };
  }

  if (workflowStatus === "failed" || workflowStatus === "cancelled") {
    return {
      label: "Fit: not calculated",
      tone: "badge-info",
      title: "The pipeline did not complete, so it did not produce a Qualification fit scorecard.",
    };
  }

  if (workflowStatus === "queued" || workflowStatus === "running" || workflowStatus === "waiting") {
    return {
      label: "Fit: pending",
      tone: "badge-info",
      title: "Qualification fit is available after the pipeline completes.",
    };
  }

  return {
    label: "Fit: not scored",
    tone: "badge-info",
    title: "No Qualification fit scorecard is stored for this application workflow.",
  };
}
