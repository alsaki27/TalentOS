"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { SubmissionRecord } from "@/lib/submissionRecords";
import styles from "./CandidateSubmissionRecords.module.css";

function date(value: string) { return new Date(value).toLocaleString(); }
export function CandidateSubmissionRecords({ candidateId, canManageKeys }: { candidateId: string; canManageKeys: boolean }) {
  const [records, setRecords] = useState<SubmissionRecord[]>([]);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    fetch(`/api/candidates/${candidateId}/submission-records?${new URLSearchParams({ q: query, page: String(page), pageSize: "25" })}`,
      { cache: "no-store", signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load submission records.");
        if (!controller.signal.aborted) { setRecords(data.records); setTotal(data.total); }
      })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [candidateId, query, page, version]);

  return <section className={`card ${styles.panel}`}>
    <header className={styles.header}>
      <div><h2>Submission Records</h2><p>Questions and answers recorded while filling forms for this candidate.</p></div>
      <button className="btn" onClick={() => setVersion(v => v + 1)} disabled={loading}>Refresh</button>
    </header>
    <div className={styles.toolbar}>
      <form onSubmit={e => { e.preventDefault(); setPage(1); setQuery(search.trim()); }} className={styles.search}>
        <input className="input" aria-label="Search submission records" value={search} onChange={e => setSearch(e.target.value)} maxLength={200} placeholder="Search questions, answers or websites" />
        <button className="btn" type="submit">Search</button>
      </form>
      {canManageKeys && <Link href="/admin/extension-keys" className="btn">Manage recorder API keys</Link>}
    </div>
    <p className={styles.note}>Form entries and revisions are saved automatically. A recorded entry does not confirm that an application was submitted.</p>
    {error && <p role="alert" className="form-error">{error}</p>}
    {loading ? <p role="status">Loading submission records…</p> : !error && !records.length ?
      <div className={styles.empty}><h3>{query ? "No matching records" : "No submission records yet"}</h3><p>{query ? "Try another question, answer or website." : "Connect the recorder extension with a TalentOS API key, choose this candidate, and enable recording. Entries from every connected browser will appear here."}</p></div> : !error && <>
        <p className={styles.note}>{total.toLocaleString()} recorded {total === 1 ? "entry" : "entries"}</p>
        <div className="table-shell"><table className={`table ${styles.table}`}>
          <thead><tr><th scope="col">Question</th><th scope="col">Answer</th><th scope="col">Source & details</th></tr></thead>
          <tbody>{records.map(record => <tr key={record.id}>
            <td className={styles.question}>{record.question}</td>
            <td className={styles.answer}>{record.answer === "" ? <span className={styles.note}>Answer cleared</span> :
              record.answer.length > 1200 ? <details><summary>{record.answer.slice(0,180)}…</summary><div>{record.answer}</div></details> : record.answer}</td>
            <td className={styles.details}>
              <a href={record.page_url} target="_blank" rel="noreferrer noopener">{record.page_title || new URL(record.page_url).hostname}</a>
              <span>{date(record.recorded_at)}</span><span>{record.recorded_by_name || "Former team member"}</span>
              <details><summary>More details</summary><dl>
                <dt>Browser / computer</dt><dd>{record.instance_name}</dd>
                <dt>Page</dt><dd>{record.page_url}</dd>
                <dt>Received</dt><dd>{date(record.received_at)}</dd>
                <dt>Field type</dt><dd>{record.field_type}</dd>
                <dt>Recorded on</dt><dd>{record.event_type === "submit" ? "Form submit event (not verified)" : record.event_type}</dd>
                <dt>Field identifier</dt><dd>{record.field_key}</dd>
              </dl></details>
            </td>
          </tr>)}</tbody>
        </table></div>
        <nav className={styles.pagination} aria-label="Submission record pages"><button className="btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</button><span>Page {page} of {Math.max(1,Math.ceil(total / 25))}</span><button className="btn" disabled={page * 25 >= total} onClick={() => setPage(p => p + 1)}>Next</button></nav>
      </>}
  </section>;
}
