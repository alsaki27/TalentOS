"use client";

import type { ReactNode } from "react";
import { getCandidateResumePreview } from "@/lib/candidateResumePreview";
import styles from "./CandidateProfileOverview.module.css";

export function CandidateResumeParseSummary({ parsed, children }: { parsed: unknown; children?: ReactNode }) {
  const preview = getCandidateResumePreview(parsed);
  const counts = [
    ["Skills", preview.skillCount],
    ["Experience", preview.experience.length],
    ["Education", preview.education.length],
    ["Certifications", preview.certifications.length],
  ] as const;
  const contact = [["Name", preview.contact.name], ["Email", preview.contact.email], ["Phone", preview.contact.phone]] as const;
  return <section className={styles.parseSummary} aria-label="Parsed resume summary">
    <h3>Parsed resume</h3>
    {preview.parseError ? <p className={styles.parseError} role="alert">Parsing failed: {preview.parseError}</p> : <>
      <div className={styles.parseStats}>
        {contact.map(([label, value]) => <span key={label}>{label} <strong className={!value ? styles.muted : undefined}>{value ? "Found" : "Not found"}</strong></span>)}
        {counts.map(([label, count]) => <span key={label}>{label} <strong>{count}</strong></span>)}
      </div>
      <details className={styles.parseDetails}>
        <summary>View extracted details</summary>
        <div>{children}</div>
      </details>
    </>}
  </section>;
}
