export interface MissingQualificationFitDisplay {
  label: string;
  tone: "badge-info" | "badge-warning";
  title: string;
}

export interface QualificationFitRangeDisplay {
  min: number;
  max: number;
}

export function qualificationFitScoreText(
  score: number | null | undefined,
  range: QualificationFitRangeDisplay | null | undefined,
): string {
  if (score != null && Number.isFinite(Number(score))) return `${Number(score).toFixed(1)}/10`;
  if (range && Number.isFinite(Number(range.min)) && Number.isFinite(Number(range.max))) {
    const min = Number(range.min);
    const max = Number(range.max);
    return min === max ? `${min.toFixed(1)}/10` : `≥${min.toFixed(1)}/10`;
  }
  return "—";
}

/** Explain why a queue row has no Qualification fit scorecard. */
export function missingQualificationFitDisplay(
  workflowStatus: string | null | undefined,
): MissingQualificationFitDisplay {
  if (workflowStatus === "completed") {
    return {
      label: "Fit: no scorecard",
      tone: "badge-info",
      title: "No Qualification fit scorecard is stored for this completed workflow. Older runs may predate this score; review a recent run if you expected one.",
    };
  }

  if (workflowStatus === "failed" || workflowStatus === "cancelled") {
    return {
      label: "Fit: not calculated",
      tone: "badge-info",
      title: "The pipeline did not complete, so it did not produce a Qualification fit scorecard.",
    };
  }

  if (["queued", "running", "waiting"].includes(workflowStatus ?? "")) {
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
