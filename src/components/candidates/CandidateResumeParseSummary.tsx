"use client";

import type { ReactNode } from "react";
import styles from "./CandidateProfileOverview.module.css";

interface ParsedResume {
  name?: string;
  email?: string;
  phone?: string;
  summary?: string;
  skills?: unknown[];
  experience?: unknown[];
  education?: unknown[];
  certifications?: unknown[];
  parse_error?: string;
}

export function CandidateResumeParseSummary({ parsed, children }: { parsed: ParsedResume; children: ReactNode }) {
  const counts = [
    ["Skills", Array.isArray(parsed.skills) ? parsed.skills.length : 0],
    ["Experience", Array.isArray(parsed.experience) ? parsed.experience.length : 0],
    ["Education", Array.isArray(parsed.education) ? parsed.education.length : 0],
    ["Certifications", Array.isArray(parsed.certifications) ? parsed.certifications.length : 0],
  ] as const;
  const contact = [["Name", parsed.name], ["Email", parsed.email], ["Phone", parsed.phone]] as const;
  return <section className={styles.parseSummary} aria-label="Parsed resume summary">
    <h3>Parsed resume</h3>
    {parsed.parse_error ? <p className={styles.parseError} role="alert">Parsing failed: {parsed.parse_error}</p> : <>
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
