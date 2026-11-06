import type { ScheduledMatchQuality } from "@/lib/scheduledMatchQuality";
import styles from "./review-queue.module.css";

export function MatchEvidence({ quality }: { quality?: ScheduledMatchQuality | null }) {
  if (!quality?.assessment) return null;
  return <details className={styles.matchEvidence}>
    <summary>Compare job requirements with resume evidence</summary>
    {quality.assessment.requirements.map((item, index) => <section key={index}>
      <strong>{item.requirement} · {item.assessment}</strong>
      <div className={styles.evidenceColumns}>
        <div><small>Job requirement</small><blockquote>{item.jd_quote}</blockquote></div>
        <div><small>Resume evidence</small><blockquote>{item.resume_quote || "Not documented in this resume."}</blockquote></div>
      </div>
    </section>)}
  </details>;
}
