"use client";

import { getCandidateResumePreview } from "@/lib/candidateResumePreview";
import styles from "./CandidateProfileOverview.module.css";

export function CandidateParsedResumeDetails({ parsed }: { parsed: unknown }) {
  const preview = getCandidateResumePreview(parsed);
  if (preview.parseError) return <p className={styles.parseError} role="alert">Parsing failed: {preview.parseError}</p>;
  if (!preview.hasContent) return <p className="muted">No structured data was extracted from this resume.</p>;

  const contact = [["Name", preview.contact.name], ["Email", preview.contact.email], ["Phone", preview.contact.phone], ["Location", preview.contact.location]];
  const lists = [["Experience", preview.experience], ["Education", preview.education], ["Certifications", preview.certifications]] as const;
  return <div className={styles.parsedGrid}>
    {contact.map(([label, value]) => <div key={label}><label>{label}</label><p className="muted">{value || "—"}</p></div>)}
    {preview.summary && <div className={styles.parsedSection}><label>Summary</label><p className="muted">{preview.summary}</p></div>}
    <div className={styles.parsedSection}>
      <label>Skills</label>
      {preview.skillGroups.length ? preview.skillGroups.map((group, index) => <div className={styles.parsedSkillGroup} key={index}>
        {group.title && <strong>{group.title}</strong>}
        <div className={styles.parsedSkills}>{group.skills.map((skill, skillIndex) => <span key={skillIndex} className="badge">{skill}</span>)}</div>
      </div>) : <p className="muted">—</p>}
    </div>
    {lists.map(([label, items]) => <div className={styles.parsedSection} key={label}>
      <label>{label}</label>
      {items.length ? <ul className={styles.parsedList}>{items.map((item, index) => <li key={index} className="muted">{item}</li>)}</ul> : <p className="muted">—</p>}
    </div>)}
  </div>;
}
