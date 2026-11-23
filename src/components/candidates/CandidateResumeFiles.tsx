"use client";

import styles from "./CandidateProfileOverview.module.css";

interface ResumeFile {
  id: string;
  label: string;
  kind: string;
  filename: string;
  file_url: string;
  created_at: string;
}

export function CandidateResumeFiles({ files, primaryResumeId, onAdd, onDelete }: {
  files: ResumeFile[];
  primaryResumeId: string | null;
  onAdd: () => void;
  onDelete: (id: string) => void;
}) {
  return <section className={styles.variants} aria-label="Resume files">
    <header className={styles.summaryHeader}>
      <div><h2>Uploaded resumes and cover letters <span className={styles.muted}>({files.length})</span></h2>
        <p className={styles.compactNote}>Uploaded resumes and cover letters for this candidate. The primary resume is marked below.</p></div>
      <button type="button" className="btn-primary btn-sm" onClick={onAdd}>Add file</button>
    </header>
    {!files.length ? <p className={styles.compactNote}>No resume files or cover letters uploaded yet.</p> :
      <div className={styles.resumeFilesTable}>
        <table className="table">
          <thead><tr><th>Label</th><th>Type</th><th>File</th><th>Uploaded</th><th>Actions</th></tr></thead>
          <tbody>{files.map((file) => <tr key={file.id}>
            <td><strong>{file.label}</strong>{file.id === primaryResumeId && <span className={styles.primaryBadge}>Primary</span>}</td>
            <td>{file.kind === "cover_letter" ? "Cover letter" : "Resume"}</td>
            <td><a href={file.file_url} target="_blank" rel="noreferrer">{file.filename}</a></td>
            <td>{new Date(file.created_at).toLocaleDateString()}</td>
            <td><button type="button" className="btn-outline btn-sm" onClick={() => onDelete(file.id)}>Delete</button></td>
          </tr>)}</tbody>
        </table>
      </div>}
  </section>;
}
