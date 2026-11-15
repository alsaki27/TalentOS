import { Check } from "lucide-react";
import styles from "./ApplicationProgress.module.css";

const labels = ["Preparation", "Applied", "Interview", "Outcome"];

const stageLabels: Record<string, string> = {
  in_ai_pipeline: "In AI pipeline",
  ready_for_review: "Ready for AE review",
  ready_for_application: "Ready for AE application",
  assigned: "Assigned",
  stacked: "Queued",
  in_progress: "In progress",
  applied: "Applied",
  replied: "Screening",
  screening: "Screening",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  on_hold: "On hold",
  closed: "Closed",
};

export function applicationStageLabel(stage: string | null | undefined) {
  return stage ? stageLabels[stage] || stage.replace(/_/g, " ") : "Unspecified";
}

const lifecycle = new Set(["screening", "replied", "interview", "offer", "rejected", "withdrawn", "on_hold", "closed"]);

export function currentApplicationStage(status: string, canonical: string | null, aeStage: string | null) {
  // Legacy writers still advance employer status after the AE hand-off.
  if (canonical === "on_hold" || canonical === "closed") return canonical;
  if (status === "applied" || lifecycle.has(status)) return status;
  return canonical || aeStage || status;
}

function milestone(stage: string) {
  if (["offer", "rejected", "withdrawn", "closed"].includes(stage)) return 3;
  if (stage === "interview") return 2;
  if (["applied", "replied", "screening"].includes(stage)) return 1;
  return 0;
}

export default function ApplicationProgress({ stage, history = [] }: { stage: string; history?: string[] }) {
  const reached = new Set<number>(history.map(milestone));
  const prior = Math.max(0, ...[...reached].filter((step) => step < 3));
  const current = stage === "on_hold" ? prior : milestone(stage);
  const closed = ["rejected", "withdrawn", "closed"].includes(stage);
  const currentLabel = applicationStageLabel(stage);
  return (
    <ol className={styles.track} aria-label="Application progress">
      {labels.map((label, index) => {
        const isCurrent = index === current;
        const complete = index < current && (!closed || index === 0 || reached.has(index) || index < prior);
        return (
          <li key={label} aria-current={isCurrent ? "step" : undefined} data-state={isCurrent ? "current" : complete ? "complete" : "pending"}>
            <span className={styles.dot} aria-hidden="true">{complete ? <Check size={14} strokeWidth={3} /> : index + 1}</span>
            <span>{label}</span>
            {isCurrent && currentLabel !== label && <small>{currentLabel}</small>}
            {complete && <span className={styles.visuallyHidden}> completed</span>}
          </li>
        );
      })}
    </ol>
  );
}
